/*
 * File: engine.ts
 * Project: deepsproxy
 * Agent State Machine Engine - core orchestration loop
 * Manages phase transitions, LLM calls, tool execution, and event emission.
 */

import { v4 as uuidv4 } from "uuid";
import type {
  AgentState,
  AgentPhase,
  AgentConfig,
  AgentEvent,
  AgentEventListener,
  LLMAdapter,
  LLMResponse,
} from "./types.ts";
import type {
  Message,
  ParsedToolCall,
  ToolCallResult,
  FunctionToolDefinition,
} from "../types/openai.ts";
import { registry } from "../tools/registry.ts";
import { SchemaValidationError } from "../tools/schema.ts";

// ─── State Factory ─────────────────────────────────────────────────────────────

function createInitialState(
  model: string,
  stream: boolean,
  messages: Message[],
  tools: FunctionToolDefinition[],
  config: AgentConfig
): AgentState {
  const now = Date.now();
  return {
    phase: "idle",
    runId: uuidv4(),
    model,
    stream,
    messages: [...messages],
    tools,
    turn: 0,
    maxTurns: config.maxTurns ?? 10,
    pendingToolCalls: [],
    toolResults: [],
    finalContent: null,
    finishReason: null,
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
    },
    error: null,
    timestamps: {
      created: now,
      started: undefined,
      completed: undefined,
      lastTurnAt: undefined,
      erroredAt: undefined,
    },
    state: config.initialState ? { ...config.initialState } : {},
  };
}

// ─── Tool Execution ────────────────────────────────────────────────────────────

const TOOL_START_TAG = '<' + 'tool_call>';
const TOOL_END_TAG = '</' + 'tool_call>';

async function executeToolCalls(
  toolCalls: ParsedToolCall[],
  state: AgentState,
  emit: (e: AgentEvent) => void
): Promise<ToolCallResult[]> {
  const results: ToolCallResult[] = [];

  for (const tc of toolCalls) {
    const startTs = Date.now();
    emit({ type: 'tool_start', turn: state.turn, toolName: tc.name, toolCallId: tc.id, timestamp: startTs });

    try {
      if (!registry.has(tc.name)) {
        const r: ToolCallResult = {
          toolCallId: tc.id,
          name: tc.name,
          result: JSON.stringify({ error: `Unknown tool: '${tc.name}'` }),
          isError: true,
        };
        results.push(r);
        emit({ type: 'tool_end', turn: state.turn, toolName: tc.name, toolCallId: tc.id, isError: true, duration: Date.now() - startTs, timestamp: Date.now() });
        continue;
      }

      const result = await registry.execute(tc.name, tc.arguments, {
        messages: state.messages,
        turn: state.turn,
        model: state.model,
      });

      results.push({ toolCallId: tc.id, name: tc.name, result, isError: false });
      emit({ type: 'tool_end', turn: state.turn, toolName: tc.name, toolCallId: tc.id, isError: false, duration: Date.now() - startTs, timestamp: Date.now() });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isValidation = err instanceof SchemaValidationError;
      results.push({
        toolCallId: tc.id,
        name: tc.name,
        result: JSON.stringify({
          error: isValidation ? 'Schema validation failed' : 'Tool execution error',
          details: msg,
        }),
        isError: true,
      });
      emit({ type: 'tool_end', turn: state.turn, toolName: tc.name, toolCallId: tc.id, isError: true, duration: Date.now() - startTs, timestamp: Date.now() });
    }
  }

  return results;
}

// ─── Phase Transition ──────────────────────────────────────────────────────────

function transition(state: AgentState, to: AgentPhase, emit: (e: AgentEvent) => void): void {
  const from = state.phase;
  state.phase = to;
  emit({ type: 'phase_change', from, to, timestamp: Date.now() });

  if (to === 'completed') state.timestamps.completed = Date.now();
  if (to === 'error') state.timestamps.erroredAt = Date.now();
}

// ─── Agent Engine ──────────────────────────────────────────────────────────────

export class AgentEngine {
  private listeners: AgentEventListener[] = [];

  on(listener: AgentEventListener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private emit(event: AgentEvent): void {
    for (const l of this.listeners) {
      try { l(event); } catch { /* listener errors must not crash the engine */ }
    }
  }

  /**
   * Run a full agentic loop (non-streaming).
   * Returns the final text content once the agent stops calling tools.
   */
  async run(
    adapter: LLMAdapter,
    messages: Message[],
    model: string,
    config: AgentConfig = {}
  ): Promise<string> {
    const tools = registry.listNames().length > 0 ? registry.toOpenAITools() : [];
    const state = createInitialState(model, false, messages, tools, config);

    state.timestamps.started = Date.now();
    transition(state, 'planning', this.emit.bind(this));

    for (let turn = 0; turn < state.maxTurns; turn++) {
      state.turn = turn;
      state.timestamps.lastTurnAt = Date.now();

      // ── Call LLM ──
      transition(state, 'calling_llm', this.emit.bind(this));
      this.emit({ type: 'llm_request', turn, messageCount: state.messages.length, timestamp: Date.now() });

      let response: LLMResponse;
      try {
        const signal = config.llmTimeout
          ? AbortSignal.timeout(config.llmTimeout)
          : undefined;
        response = await adapter.complete(state.messages, state.tools.length ? state.tools : undefined, model, signal);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        state.error = { code: 'LLM_ERROR', message: msg, phase: 'calling_llm', recoverable: false, cause: err };
        transition(state, 'error', this.emit.bind(this));
        this.emit({ type: 'error', phase: 'calling_llm', code: 'LLM_ERROR', message: msg, timestamp: Date.now() });
        throw new Error(msg);
      }

      this.emit({ type: 'llm_response', turn, contentLength: response.content?.length ?? 0, toolCallCount: response.toolCalls?.length ?? 0, timestamp: Date.now() });

      // Accumulate usage
      if (response.usage) {
        state.usage.promptTokens += response.usage.promptTokens ?? 0;
        state.usage.completionTokens += response.usage.completionTokens ?? 0;
        state.usage.totalTokens += response.usage.totalTokens ?? 0;
        state.usage.cachedTokens += response.usage.cachedTokens ?? 0;
      }

      // ── Parse ──
      transition(state, 'parsing', this.emit.bind(this));

      const toolCalls: ParsedToolCall[] = response.toolCalls?.length
        ? response.toolCalls
        : [];

      if (toolCalls.length === 0) {
        // No more tool calls — we're done
        state.finalContent = response.content ?? '';
        state.finishReason = response.finishReason ?? 'stop';
        transition(state, 'completed', this.emit.bind(this));
        this.emit({
          type: 'completed',
          turn,
          totalTokens: state.usage.totalTokens,
          duration: Date.now() - (state.timestamps.started ?? Date.now()),
          timestamp: Date.now(),
        });
        return state.finalContent;
      }

      // ── Execute tools ──
      transition(state, 'executing', this.emit.bind(this));
      state.pendingToolCalls = toolCalls;

      const toolResults = await executeToolCalls(toolCalls, state, this.emit.bind(this));
      state.toolResults = toolResults;

      // Append assistant + tool messages to history
      state.messages.push({
        role: 'assistant',
        content: response.content ?? null,
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });

      for (const r of toolResults) {
        state.messages.push({
          role: 'tool',
          content: r.result,
          tool_call_id: r.toolCallId,
          name: r.name,
        });
      }

      // Reset for next turn
      state.pendingToolCalls = [];
      state.toolResults = [];
      transition(state, 'planning', this.emit.bind(this));
    }

    // Exceeded maxTurns
    const errMsg = `Execution loop exceeded maximum turns (${state.maxTurns}).`;
    state.error = { code: 'MAX_TURNS', message: errMsg, phase: 'planning', recoverable: false };
    transition(state, 'error', this.emit.bind(this));
    this.emit({ type: 'error', phase: 'planning', code: 'MAX_TURNS', message: errMsg, timestamp: Date.now() });
    throw new Error(errMsg);
  }

  /**
   * Run a full agentic loop (streaming).
   * Yields LLMStreamChunks and handles tool calls between turns.
   */
  async *stream(
    adapter: LLMAdapter,
    messages: Message[],
    model: string,
    config: AgentConfig = {}
  ): AsyncGenerator<import('./types.ts').LLMStreamChunk> {
    const tools = registry.listNames().length > 0 ? registry.toOpenAITools() : [];
    const state = createInitialState(model, true, messages, tools, config);

    state.timestamps.started = Date.now();
    transition(state, 'planning', this.emit.bind(this));

    for (let turn = 0; turn < state.maxTurns; turn++) {
      state.turn = turn;
      state.timestamps.lastTurnAt = Date.now();

      transition(state, 'calling_llm', this.emit.bind(this));
      this.emit({ type: 'llm_request', turn, messageCount: state.messages.length, timestamp: Date.now() });

      const signal = config.llmTimeout ? AbortSignal.timeout(config.llmTimeout) : undefined;
      const streamGen = adapter.stream(state.messages, state.tools.length ? state.tools : undefined, model, signal);

      let accContent = '';
      let accToolCalls: ParsedToolCall[] = [];
      let finishReason = 'stop';

      transition(state, 'streaming', this.emit.bind(this));

      for await (const chunk of streamGen) {
        this.emit({ type: 'stream_chunk', turn, chunkSize: chunk.content?.length ?? 0, timestamp: Date.now() });
        yield chunk;

        if (chunk.content) accContent += chunk.content;
        if (chunk.toolCalls) accToolCalls.push(...chunk.toolCalls);
        if (chunk.done) {
          finishReason = chunk.finishReason ?? 'stop';
          if (chunk.usage) {
            state.usage.promptTokens += chunk.usage.promptTokens ?? 0;
            state.usage.completionTokens += chunk.usage.completionTokens ?? 0;
            state.usage.totalTokens += chunk.usage.totalTokens ?? 0;
            state.usage.cachedTokens += chunk.usage.cachedTokens ?? 0;
          }
        }
      }

      transition(state, 'parsing', this.emit.bind(this));

      if (accToolCalls.length === 0) {
        state.finalContent = accContent;
        state.finishReason = finishReason;
        transition(state, 'completed', this.emit.bind(this));
        this.emit({
          type: 'completed',
          turn,
          totalTokens: state.usage.totalTokens,
          duration: Date.now() - (state.timestamps.started ?? Date.now()),
          timestamp: Date.now(),
        });
        return;
      }

      transition(state, 'executing', this.emit.bind(this));
      state.pendingToolCalls = accToolCalls;
      const toolResults = await executeToolCalls(accToolCalls, state, this.emit.bind(this));
      state.toolResults = toolResults;

      state.messages.push({
        role: 'assistant',
        content: accContent || null,
        tool_calls: accToolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });

      for (const r of toolResults) {
        state.messages.push({
          role: 'tool',
          content: r.result,
          tool_call_id: r.toolCallId,
          name: r.name,
        });
      }

      state.pendingToolCalls = [];
      state.toolResults = [];
      transition(state, 'planning', this.emit.bind(this));
    }

    const errMsg = `Execution loop exceeded maximum turns (${state.maxTurns}).`;
    state.error = { code: 'MAX_TURNS', message: errMsg, phase: 'planning', recoverable: false };
    transition(state, 'error', this.emit.bind(this));
    this.emit({ type: 'error', phase: 'planning', code: 'MAX_TURNS', message: errMsg, timestamp: Date.now() });
    throw new Error(errMsg);
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────────

export const agentEngine = new AgentEngine();