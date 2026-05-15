/*
 * File: playwright.ts
 * Project: deepsproxy
 * Author: Pedro Farias
 * Created: 2026-05-09
 * 
 * Last Modified: Sat May 09 2026
 * Modified By: Pedro Farias
 */

import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Caminho para o perfil persistente (dois níveis acima de src/)
const PROFILE_PATH = path.resolve(__dirname, '../../deepseek_profile');
const STORAGE_STATE_PATH = path.resolve(__dirname, '../../deepseek_profile/storage_state.json');

let context: BrowserContext | null = null;
export let activePage: Page | null = null;  // Tab de automação
export let deepseekPage: Page | null = null; // Tab do DeepSeek (headers/PoW)
export let uiPage: Page | null = null;       // Tab do Painel de Controle
let currentHeaders: Record<string, string> = {};

export function getActivePage() {
  return activePage;
}

export async function ensureActivePage(): Promise<Page> {
  if (!activePage) {
    throw new Error('Playwright not initialized');
  }

  return activePage;
}

export async function initPlaywright(headless?: boolean) {
  if (process.env.TEST_MOCK_PLAYWRIGHT) return;
  if (context) {
    return;
  }

  const resolvedHeadless = headless !== undefined
    ? headless
    : process.env.PLAYWRIGHT_HEADLESS !== undefined
      ? process.env.PLAYWRIGHT_HEADLESS !== 'false'
      : true;

  const timeout = process.env.PLAYWRIGHT_TIMEOUT
    ? parseInt(process.env.PLAYWRIGHT_TIMEOUT, 10)
    : 30000;

  // Remove Chrome lock files that prevent re-launch after unclean shutdown
  for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const p = path.join(PROFILE_PATH, lockFile);
    try { fs.unlinkSync(p); } catch { /* not present */ }
  }

  let lastErr: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      context = await chromium.launchPersistentContext(PROFILE_PATH, {
        headless: resolvedHeadless,
        args: ['--start-maximized', '--no-sandbox'],
        viewport: null,
        timeout,
      });

      // Bloqueia a abertura automática de novas abas por sites (popups, target="_blank")
      context.on('page', async (p) => {
        await new Promise(r => setTimeout(r, 800)); // Pequena espera para estabilizar
        if (p !== activePage && p !== uiPage && p !== deepseekPage) {
          console.log('[PLAYWRIGHT] Fechando aba não autorizada aberta pelo site.');
          await p.close().catch(() => null);
        }
      });

      activePage = context.pages()[0] ?? await context.newPage();
      return;
    } catch (err: any) {
      lastErr = err;
      console.error(`Failed to launch browser (attempt ${attempt}/3):`, err);
      // Clean lock files again before retry
      for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
        const p = path.join(PROFILE_PATH, lockFile);
        try { fs.unlinkSync(p); } catch { /* not present */ }
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr;
}

/**
 * Abre um segundo tab dedicado à automação e o define como activePage.
 * O deepseekPage (tab 0) permanece inalterado.
 */
export async function openAutomationPage(): Promise<Page> {
  if (process.env.TEST_MOCK_PLAYWRIGHT) {
    return activePage!;
  }
  if (!context) {
    throw new Error('Playwright not initialized — call initPlaywright first');
  }
  const autoPage = await context.newPage();
  activePage = autoPage;
  return autoPage;
}

/**
 * Abre um tab dedicado à Interface de Usuário (Painel Web) no mesmo navegador.
 */
export async function openUIPage(url: string): Promise<Page> {
  if (process.env.TEST_MOCK_PLAYWRIGHT) {
    return activePage!;
  }
  if (!context) {
    throw new Error('Playwright not initialized');
  }
  uiPage = await context.newPage();
  await uiPage.goto(url);
  await uiPage.bringToFront();
  return uiPage;
}

/**
 * Configura deepseekPage apontando para o tab do DeepSeek (tab 0).
 * Deve ser chamado após initPlaywright e antes de openAutomationPage.
 */
export function setDeepSeekPage(page: Page) {
  deepseekPage = page;
}

export async function saveStorageState() {
  if (context) {
    await context.storageState({ path: STORAGE_STATE_PATH });
    console.log('[PLAYWRIGHT] Storage state saved to', STORAGE_STATE_PATH);
  }
}

export async function ensureUIFocus() {
  if (uiPage) {
    await uiPage.bringToFront().catch(() => null);
  }
}

export async function closePlaywright() {
  if (process.env.TEST_MOCK_PLAYWRIGHT) return;
  if (context) {
    await context.close();
    context = null;
    activePage = null;
  }
}

/**
 * Ensures the session is valid and extracts headers, PoW, and session ID.
 * Uses deepseekPage (tab dedicado ao DeepSeek), não o tab de automação.
 */
export async function getDeepSeekHeaders(forceNew = false): Promise<{ headers: Record<string, string>, chatSessionId: string, parentMessageId: number | null }> {
  if (process.env.TEST_MOCK_PLAYWRIGHT) {
    const mockSessionId = process.env.TEST_SESSION_ID || 'mock-session';
    return { headers: { authorization: 'Bearer MOCK' }, chatSessionId: mockSessionId, parentMessageId: null };
  }

  const page = deepseekPage ?? activePage;
  if (!page) {
    throw new Error('Playwright not initialized');
  }

  const currentUrl = page.url();
  console.error('[DIAG getDeepSeekHeaders] page URL:', currentUrl);
  const isOnDeepSeek = currentUrl.includes('chat.deepseek.com');
  const isOnSpecificChat = isOnDeepSeek && /\/chat\/\d+/.test(currentUrl);

  if (!isOnDeepSeek || forceNew || isOnSpecificChat) {
    console.error('[DIAG getDeepSeekHeaders] navigating to chat.deepseek.com...');
    await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
  } else {
    // Apenas permanece na página atual sem forçar foco
  }

  const chatInputSelector = '#chat-input, textarea, [contenteditable="true"]';
  const hasTextarea = await page.waitForSelector(chatInputSelector, { timeout: 60000 }).then(() => true).catch(() => false);
  console.error('[DIAG getDeepSeekHeaders] chat input found:', hasTextarea);
  if (!hasTextarea) {
    throw new Error('Timeout waiting for chat input. Are you logged in?');
  }

  // Check if user is actually logged in
  const pageState = await page.evaluate(() => {
    const hasLoginBtn = !!document.querySelector('a[href*="login"], .login-btn, button.login');
    const hasUserMenu = !!document.querySelector('[class*="user"], [class*="avatar"], .user-info');
    const token = localStorage.getItem('userToken') || localStorage.getItem('access_token') || '';
    return { hasLoginBtn, hasUserMenu, hasToken: !!token };
  });

  if (pageState.hasLoginBtn && !pageState.hasUserMenu) {
    throw new Error('SESSAO_EXPIRADA: Você não está logado no DeepSeek. Por favor, execute "npm run login" no terminal.');
  }

  return new Promise<{ headers: Record<string, string>, chatSessionId: string, parentMessageId: number | null }>((resolve, reject) => {
    let routeHandler: any;

    const timeout = setTimeout(() => {
      console.error('[DIAG getDeepSeekHeaders] TIMEOUT waiting for route interception');
      if (routeHandler) page.unroute('**/api/v0/chat/completion', routeHandler).catch(() => null);
      reject(new Error('Timeout waiting for PoW headers'));
    }, 60000);

    routeHandler = async (route: any, request: any) => {
      const url = request.url();
      if (!url.includes('/api/v0/chat/completion')) {
        return route.continue();
      }

      const reqHeaders = request.headers();
      if (!reqHeaders['authorization'] || !reqHeaders['x-ds-pow-response']) {
        // Se pegamos uma requisição incompleta (sem auth/pow), deixa ela passar e continua esperando a correta
        return route.continue();
      }

      clearTimeout(timeout);
      console.error('[DIAG getDeepSeekHeaders] all relevant headers:', Object.keys(reqHeaders).filter(k => k.startsWith('x-') || k.includes('auth') || k.includes('cookie')));
      let uiSessionId = '';
      let uiParentMessageId: number | null = null;

      const postData = request.postData();
      if (postData) {
        try {
          const payload = JSON.parse(postData);
          if (payload.chat_session_id) uiSessionId = payload.chat_session_id;
          if (payload.parent_message_id !== undefined) uiParentMessageId = payload.parent_message_id;
        } catch (e) { /* ignore */ }
      }

      const extractedHeaders = {
        'x-ds-pow-response': reqHeaders['x-ds-pow-response'] || '',
        'x-hif-dliq': reqHeaders['x-hif-dliq'] || '',
        'x-hif-leim': reqHeaders['x-hif-leim'] || '',
        'authorization': reqHeaders['authorization'] || '',
        'cookie': reqHeaders['cookie'] || ''
      };

      console.error('[DIAG getDeepSeekHeaders] extracted auth:', extractedHeaders['authorization']?.slice(0, 60) || 'EMPTY', 'pow:', !!extractedHeaders['x-ds-pow-response']);
      currentHeaders = extractedHeaders;
      await route.abort('aborted');
      await page.unroute('**/api/v0/chat/completion', routeHandler);

      resolve({ headers: extractedHeaders, chatSessionId: uiSessionId, parentMessageId: uiParentMessageId });
    };

    page.route('**/*', routeHandler).then(async () => {
      // Dispara o fetch silencioso IMEDIATAMENTE como primeira tentativa (funciona melhor em background)
      page.evaluate(() => {
        fetch('/api/v0/chat/completion', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: 'Liveness', model_type: null, ref_file_ids: [], thinking_enabled: false, search_enabled: false, preempt: false }),
        }).catch(() => null);
      }).catch(() => null);

      try {
        await page.waitForLoadState('networkidle').catch(() => null);
        await page.waitForTimeout(2000);
        
        const chatInputSelector = '#chat-input, textarea, [contenteditable="true"]';
        const input = await page.waitForSelector(chatInputSelector, { timeout: 10000 }).catch(() => null);
        
        if (input) {
          await input.fill('Oi');
          await page.keyboard.press('Enter');
          const sendBtnSelector = 'button[class*="send"], .chat-input-send-button';
          await page.click(sendBtnSelector, { force: true, timeout: 3000 }).catch(() => null);
        }
      } catch (e) {
        console.error('[DIAG getDeepSeekHeaders] Background interaction skipped/failed, relying on fetch.');
      }
    });
  }).finally(() => {
    // Não força mais o foco, pois não estamos mais saindo da aba do Dashboard
  });
}


