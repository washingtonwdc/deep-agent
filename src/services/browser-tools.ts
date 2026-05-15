/*
 * File: browser-tools.ts
 * Project: deepsproxy
 * Browser action tools for the AI agent
 */

import { activePage } from './playwright.ts';

// ── Page Context ──────────────────────────────────────────────────────────────

export async function getPageContext(): Promise<string> {
  const page = activePage;
  if (!page) return 'Browser not initialized';
  try {
    const url = page.url();
    const title = await page.title().catch(() => '');
    const ctx = await page.evaluate(() => {
      const bodyText = (document.body?.innerText ?? '').slice(0, 2500);
      const inputs = Array.from(document.querySelectorAll('input:not([type=hidden]),textarea,select'))
        .filter(el => { const s = window.getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; })
        .map(el => {
          const e = el as HTMLInputElement;
          const lbl = e.id ? (document.querySelector(`label[for="${e.id}"]`)?.textContent?.trim() ?? '') : '';
          return `  [${el.tagName.toLowerCase()} type="${e.type||'text'}" id="${e.id}" name="${e.name}" placeholder="${e.placeholder}"${lbl ? ` label="${lbl}"` : ''}]`;
        }).slice(0, 15);
      const btns = Array.from(document.querySelectorAll('button,[role=button],input[type=submit],a[href]'))
        .filter(el => { const s = window.getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; })
        .map(el => {
          const text = (el.textContent?.trim() ?? (el as HTMLInputElement).value ?? '').slice(0, 60);
          if (!text) return null;
          const id = el.id ? ` id="${el.id}"` : '';
          const href = (el as HTMLAnchorElement).href ? ` href="${(el as HTMLAnchorElement).href.slice(0,80)}"` : '';
          return `  ["${text}"${id}${href}]`;
        }).filter(Boolean).slice(0, 20);
      return { bodyText, inputs, btns };
    }).catch(() => ({ bodyText: '', inputs: [] as string[], btns: [] as (string|null)[] }));

    return [
      `URL: ${url}`,
      `Título: ${title}`,
      `\nTexto visível:\n${ctx.bodyText}`,
      `\nInputs:\n${ctx.inputs.join('\n') || '  (nenhum)'}`,
      `\nBotões/Links:\n${(ctx.btns as string[]).join('\n') || '  (nenhum)'}`,
    ].join('\n');
  } catch (err: any) {
    return `Erro ao ler página: ${err?.message ?? err}`;
  }
}

export async function takeScreenshot(): Promise<Buffer | null> {
  const page = activePage;
  if (!page) return null;
  try { return await page.screenshot({ type: 'jpeg', quality: 75 }); }
  catch { return null; }
}

// ── Tool Interface ────────────────────────────────────────────────────────────

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
}

// ── Tool Implementations ──────────────────────────────────────────────────────

export const agentTools: AgentTool[] = [
  {
    name: 'navigate_to',
    description: 'Navega para uma URL específica no navegador.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL completa (ex: https://google.com)' } }, required: ['url'] },
    async execute({ url }) {
      const page = activePage; if (!page) throw new Error('Browser not initialized');
      const full = String(url).startsWith('http') ? String(url) : `https://${url}`;
      await page.goto(full, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(800);
      return `✓ Navegado para: ${page.url()}`;
    },
  },
  {
    name: 'click_element',
    description: 'Clica em um elemento usando seletor CSS ou texto visível do botão/link.',
    parameters: { type: 'object', properties: { selector: { type: 'string', description: 'Seletor CSS ou texto visível' } }, required: ['selector'] },
    async execute({ selector }) {
      const page = activePage; if (!page) throw new Error('Browser not initialized');
      const sel = String(selector);
      try { await page.click(sel, { timeout: 5000 }); }
      catch { await page.getByText(sel, { exact: false }).first().click({ timeout: 5000 }); }
      await page.waitForTimeout(600);
      return `✓ Clicado em: ${sel}`;
    },
  },
  {
    name: 'type_text',
    description: 'Digita texto em um campo de input ou textarea.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Seletor CSS do campo' },
        text: { type: 'string', description: 'Texto a digitar' },
        clear_first: { type: 'boolean', description: 'Limpar antes de digitar (default: true)' },
      },
      required: ['selector', 'text'],
    },
    async execute({ selector, text, clear_first = true }) {
      const page = activePage; if (!page) throw new Error('Browser not initialized');
      const sel = String(selector); const txt = String(text);
      if (clear_first !== false) { await page.fill(sel, txt); }
      else { await page.locator(sel).type(txt); }
      return `✓ Digitado "${txt}" em: ${sel}`;
    },
  },
  {
    name: 'press_key',
    description: 'Pressiona uma tecla especial (Enter, Escape, Tab, ArrowDown, etc.).',
    parameters: { type: 'object', properties: { key: { type: 'string', description: 'Nome da tecla: Enter, Escape, Tab, ArrowDown, Space...' } }, required: ['key'] },
    async execute({ key }) {
      const page = activePage; if (!page) throw new Error('Browser not initialized');
      await page.keyboard.press(String(key));
      await page.waitForTimeout(400);
      return `✓ Tecla: ${key}`;
    },
  },
  {
    name: 'scroll_page',
    description: 'Rola a página para cima ou para baixo.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'] },
        pixels: { type: 'number', description: 'Pixels para rolar (default: 600)' },
      },
      required: ['direction'],
    },
    async execute({ direction, pixels = 600 }) {
      const page = activePage; if (!page) throw new Error('Browser not initialized');
      const delta = direction === 'down' ? Number(pixels) : -Number(pixels);
      await page.evaluate((d: number) => window.scrollBy(0, d), delta);
      await page.waitForTimeout(300);
      return `✓ Scroll ${direction} ${pixels}px`;
    },
  },
  {
    name: 'wait_seconds',
    description: 'Aguarda N segundos para carregamentos lentos.',
    parameters: { type: 'object', properties: { seconds: { type: 'number', description: 'Segundos (max 10)' } }, required: ['seconds'] },
    async execute({ seconds }) {
      const page = activePage; if (!page) throw new Error('Browser not initialized');
      await page.waitForTimeout(Math.min(Number(seconds) * 1000, 10000));
      return `✓ Aguardado ${seconds}s`;
    },
  },
  {
    name: 'go_back',
    description: 'Volta para a página anterior.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const page = activePage; if (!page) throw new Error('Browser not initialized');
      await page.goBack(); return '✓ Voltou';
    },
  },
  {
    name: 'go_forward',
    description: 'Avança para a próxima página.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const page = activePage; if (!page) throw new Error('Browser not initialized');
      await page.goForward(); return '✓ Avançou';
    },
  },
  {
    name: 'read_page',
    description: 'Lê o conteúdo e estrutura atual da página (URL, texto, inputs, botões).',
    parameters: { type: 'object', properties: {} },
    async execute() { return await getPageContext(); },
  },
  {
    name: 'select_option',
    description: 'Seleciona uma opção em um <select>.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Seletor CSS do <select>' },
        value: { type: 'string', description: 'Valor ou texto da opção' },
      },
      required: ['selector', 'value'],
    },
    async execute({ selector, value }) {
      const page = activePage; if (!page) throw new Error('Browser not initialized');
      await page.selectOption(String(selector), { label: String(value) }).catch(async () => {
        await page.selectOption(String(selector), { value: String(value) });
      });
      return `✓ Selecionado "${value}"`;
    },
  },
  {
    name: 'done',
    description: 'Marca o objetivo como concluído. Use quando a tarefa estiver 100% completa.',
    parameters: { type: 'object', properties: { summary: { type: 'string', description: 'Resumo do que foi realizado' } }, required: ['summary'] },
    async execute({ summary }) { return `DONE:${summary}`; },
  },
];

export function toolsToOpenAI() {
  return agentTools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
