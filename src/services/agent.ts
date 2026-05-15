/*
 * File: agent.ts
 * Project: deepsproxy
 * Agentic loop: goal → DeepSeek (with tools) → execute → repeat until done
 */

import { createDeepSeekStream, updateSessionParent } from './deepseek.ts';
import { agentTools, getPageContext } from './browser-tools.ts';
import { robustParseJSON } from '../utils/json.ts';
import { ensureUIFocus } from './playwright.ts';

export type AgentEventType = 'thinking' | 'action' | 'result' | 'done' | 'error' | 'status';

export interface AgentEvent {
  type: AgentEventType;
  text?: string;
  tool?: string;
  args?: Record<string, unknown>;
  turn?: number;
}

const INTERPRET_SYSTEM = "Você é um interpretador de intenções para um agente de automação de navegador. Recebe uma mensagem informal do usuário e deve identificar se é uma TAREFA DE BROWSER ou uma PERGUNTA DIRETA. Retorne APENAS um JSON.";

function buildSystemPrompt(clarifiedGoal: string): string {
  const toolList = agentTools.map(t => "- " + t.name + ": " + t.description).join("\n");
  return "Você é um agente de automação. Sua missão: " + clarifiedGoal + "\n\nFERRAMENTAS DISPONÍVEIS:\n" + toolList + "\n\nREGRAS:\n1. SEMPRE use <tool_call>{\"name\": \"...\", \"arguments\": {...}}</tool_call>.\n2. Inicie com navigate_to se necessário.\n3. Quando terminar, chame 'done'.\n\nEXEMPLO:\n<tool_call>{\"name\": \"navigate_to\", \"arguments\": {\"url\": \"https://www.google.com\"}}</tool_call>";
}

async function* collectDeepSeekResponse(
  prompt: string,
  isNew: boolean
): AsyncGenerator<AgentEvent, { content: string; reasoning: string; uiSessionId: string }> {
  const { stream, uiSessionId } = await createDeepSeekStream(prompt, false, isNew ? null : undefined);
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let content = '';
  let reasoning = '';
  let currentPath = '';
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const decoded = decoder.decode(value, { stream: true });
    buf += decoded;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const dataStr = trimmed.slice(6);
      if (dataStr === '[DONE]') continue;

      try {
        const chunk = JSON.parse(dataStr);
        import('fs').then(fs => fs.appendFileSync('chunks-debug.log', dataStr + '\n')).catch(() => {});
        
        // Track message_id for session persistence
        const mid = chunk.response_message_id ?? chunk.v?.response?.message_id ?? chunk.v?.message_id ?? chunk.message_id;
        if (mid) updateSessionParent(uiSessionId, mid);

        // Determine if chunk is reasoning or content
        if (typeof chunk.p === 'string') currentPath = chunk.p;

        let vStr = '';
        let isReasoning = currentPath.includes('think') || currentPath.includes('THINK');

        if (typeof chunk.v === 'string') {
          vStr = chunk.v;
        } else if (chunk.v?.response?.fragments?.[0]?.content) {
          vStr = chunk.v.response.fragments[0].content;
          if (chunk.v.response.fragments[0].type === 'THINK') isReasoning = true;
        } else if (Array.isArray(chunk.v) && chunk.v[0]?.content) {
          vStr = chunk.v[0].content;
          if (chunk.v[0].type === 'THINK') isReasoning = true;
        } else if (chunk.choices?.[0]?.delta) {
          const delta = chunk.choices[0].delta;
          if (delta.reasoning_content) {
            vStr = delta.reasoning_content;
            isReasoning = true;
          } else if (delta.content) {
            vStr = delta.content;
          }
        } else if (chunk.message?.content) {
          vStr = chunk.message.content;
        }

        if (vStr && vStr !== 'FINISHED') {
          if (isReasoning) {
            reasoning += vStr;
            yield { type: 'thinking', text: vStr };
          } else {
            content += vStr;
            // Envia a prosa do agente também para o Monitor de Raciocínio para mantê-lo vivo
            yield { type: 'thinking', text: vStr };
          }
        }
      } catch { }
    }
  }

  if (!content && reasoning) content = reasoning;
  return { content, reasoning, uiSessionId };
}

function parseToolCalls(content: string): any[] {
  const calls: any[] = [];
  const OPEN = '<tool_call>';
  const CLOSE = '</tool_call>';
  let rest = content;
  while (true) {
    const si = rest.indexOf(OPEN);
    if (si === -1) break;
    const ei = rest.indexOf(CLOSE, si + OPEN.length);
    if (ei === -1) break;
    const jsonStr = rest.slice(si + OPEN.length, ei).trim();
    try {
      const parsed = robustParseJSON(jsonStr);
      if (parsed && typeof parsed.name === 'string') {
        const args = parsed.arguments || parsed.args || {};
        calls.push({ name: parsed.name, args });
      }
    } catch { }
    rest = rest.slice(ei + CLOSE.length);
  }
  return calls;
}

async function interpretGoal(raw: string): Promise<any> {
  try {
    const { stream } = await createDeepSeekStream(INTERPRET_SYSTEM + "\n\nUser: " + raw + "\n\nJSON:", false, null, false);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let content = '';
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const decoded = decoder.decode(value, { stream: true });
      buf += decoded;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim().startsWith('data: ')) continue;
        try {
          const chunk = JSON.parse(line.trim().slice(6));
          let vStr = '';
          if (typeof chunk.v === 'string') vStr = chunk.v;
          else if (chunk.choices?.[0]?.delta?.content) vStr = chunk.choices[0].delta.content;
          if (vStr && vStr !== 'FINISHED') content += vStr;
        } catch { }
      }
    }
    const match = content.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch { return null; }
}

export async function* runAgent(goal: string, maxTurns = 20): AsyncGenerator<AgentEvent, void> {
  const history: string[] = [];
  let sessionId: string | null = null;
  let isNew = true;

  yield { type: 'status', text: '🎯 Objetivo: ' + goal };
  yield { type: 'status', text: '🧠 Interpretando intenção...' };
  
  let intent = await interpretGoal(goal);
  if (intent && intent.type === 'direct_answer') {
    yield { type: 'done', text: intent.answer };
    return;
  }

  const clarified = (intent && intent.clarified) || goal;
  yield { type: 'status', text: '📋 Tarefa: ' + clarified };

  for (let turn = 1; turn <= maxTurns; turn++) {
    yield { type: 'status', text: '🔄 Turno ' + turn + '/' + maxTurns };
    
    const context = await getPageContext();
    const prompt = buildSystemPrompt(clarified) + 
      "\n\nCONTEXTO DO NAVEGADOR:\n" + context + 
      "\n\nHISTÓRICO DE AÇÕES:\n" + history.join("\n") + 
      "\n\nResponda usando ferramenta ou finalize com 'done'.";

    yield { type: 'status', text: '🤔 Consultando IA...' };

    let response: any;
    try {
      const dsGen = collectDeepSeekResponse(prompt, isNew);
      while (true) {
        const { value, done } = await dsGen.next();
        if (done) {
          response = value;
          break;
        }
        yield value;
      }
      if (!sessionId) sessionId = response.uiSessionId;
      isNew = false;
    } catch (err: any) {
      yield { type: 'error', text: 'Erro na conexão: ' + (err?.message ?? err) };
      return;
    }

    if (!response || !response.content) {
      yield { type: 'error', text: 'Sem resposta do modelo.' };
      return;
    }

    const calls = parseToolCalls(response.content);
    if (calls.length === 0) {
      // Se não tem chamada de ferramenta, mas tem texto, trata como resposta final
      if (response.content.trim()) {
        yield { type: 'done', text: response.content.trim() };
      } else {
        yield { type: 'error', text: 'Agente não emitiu nenhuma ação.' };
      }
      return;
    }

    for (const call of calls) {
      const tool = agentTools.find(t => t.name === call.name);
      if (!tool) {
        yield { type: 'result', tool: call.name, text: '⚠️ Ferramenta desconhecida.' };
        continue;
      }

      yield { type: 'action', tool: call.name, args: call.args };
      try {
        const result = await tool.execute(call.args);
        if (result.startsWith('DONE:')) {
          yield { type: 'done', text: result.slice(5) };
          return;
        }
        yield { type: 'result', tool: call.name, text: result };
        history.push(call.name + " -> " + result.slice(0, 80));
      } catch (err: any) {
        const errMsg = `✗ Erro: ${err?.message ?? err}`;
        yield { type: 'result', tool: call.name, text: errMsg };
        history.push(`${call.name} FALHOU: ${err?.message ?? err}`);
      }
    }
    await ensureUIFocus();
  }
}
