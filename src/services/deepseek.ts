/*
 * File: deepseek.ts
 * Project: deepsproxy
 * Author: Pedro Farias
 * Created: 2026-05-09
 * 
 * Last Modified: Sat May 09 2026
 * Modified By: Pedro Farias
 */

import { getDeepSeekHeaders } from './playwright.ts';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = path.resolve(__dirname, '../../sessions.json');

// In-memory state to track the last message ID per session to avoid overwriting
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // Aumentado para 24 horas para melhor persistência
const MAX_SESSIONS = 500;

interface SessionEntry {
  parentId: number | null;
  updatedAt: number;
}

// Carrega sessões do arquivo ou inicializa novo Map
function loadSessions(): Map<string, SessionEntry> {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      console.log(`[DEEPSEEK] ${Object.keys(data).length} sessões carregadas do histórico.`);
      return new Map(Object.entries(data));
    }
  } catch (e) {
    console.error('[DEEPSEEK] Falha ao carregar sessões:', e);
  }
  return new Map();
}

const sessionStates: Map<string, SessionEntry> = (globalThis as any)._sessionStates || loadSessions();
(globalThis as any)._sessionStates = sessionStates;

function saveSessions() {
  try {
    const data = Object.fromEntries(sessionStates);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[DEEPSEEK] Falha ao salvar sessões:', e);
  }
}

function purgeExpiredSessions() {
  const now = Date.now();
  let changed = false;
  for (const [id, entry] of sessionStates) {
    if (now - entry.updatedAt > SESSION_TTL_MS) {
      sessionStates.delete(id);
      changed = true;
    }
  }
  if (sessionStates.size > MAX_SESSIONS) {
    const oldest = [...sessionStates.entries()]
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
      .slice(0, sessionStates.size - MAX_SESSIONS);
    for (const [id] of oldest) sessionStates.delete(id);
    changed = true;
  }
  if (changed) saveSessions();
}

export function updateSessionParent(sessionId: string, parentId: number | null) {
  if (sessionId) {
    purgeExpiredSessions();
    sessionStates.set(sessionId, { parentId, updatedAt: Date.now() });
    saveSessions();
  }
}

export interface DeepSeekPayload {
  chat_session_id: string | null;
  parent_message_id?: number | null;
  model_type: string | null;
  prompt: string;
  ref_file_ids: string[];
  thinking_enabled: boolean;
  search_enabled: boolean;
  preempt: boolean;
}

export async function createDeepSeekStream(
  prompt: string,
  enableThinking: boolean,
  forcedParentId?: number | null,
  searchEnabled = true
): Promise<{ stream: ReadableStream, headers: Record<string, string>, uiSessionId: string }> {
  // Obtain fresh headers/PoW from Playwright
  // If forcedParentId is null, it means we are explicitly starting a new session
  const { headers, chatSessionId, parentMessageId } = await getDeepSeekHeaders(forcedParentId === null);

  // Determine the actual parent ID:
  // 1. If forcedParentId is provided (even if null), use it.
  // 2. If tracked parent ID is available for this session, use it.
  // 3. Fallback to Playwright's state.
  let actualParentId: number | null = parentMessageId;
  
  if (forcedParentId !== undefined) {
    actualParentId = forcedParentId;
  } else if (chatSessionId && sessionStates.has(chatSessionId)) {
    actualParentId = sessionStates.get(chatSessionId)!.parentId;
  }

  const payload: DeepSeekPayload = {
    chat_session_id: chatSessionId || null,
    parent_message_id: actualParentId,
    model_type: null,
    prompt: prompt,
    ref_file_ids: [],
    thinking_enabled: enableThinking,
    search_enabled: searchEnabled,
    preempt: false
  };

  console.error('[DIAG deepseek] auth:', headers['authorization']?.slice(0, 60) || 'EMPTY', 'pow:', !!headers['x-ds-pow-response'], 'dliq:', !!headers['x-hif-dliq'], 'leim:', !!headers['x-hif-leim']);

  console.error('[DIAG deepseek] payload:', JSON.stringify(payload, null, 2));
  console.error('[DIAG deepseek] sending request to chat.deepseek.com/api/v0/chat/completion');

  const response = await fetch('https://chat.deepseek.com/api/v0/chat/completion', {
    method: 'POST',
    headers: {
      'accept': '*/*',
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'authorization': headers['authorization'],
      'content-type': 'application/json',
      'origin': 'https://chat.deepseek.com',
      'referer': 'https://chat.deepseek.com/',
      'x-ds-pow-response': headers['x-ds-pow-response'],
      'x-hif-dliq': headers['x-hif-dliq'],
      'x-hif-leim': headers['x-hif-leim'],
      'x-app-version': '20240126.1',
      'x-client-locale': 'pt_BR',
      'x-client-platform': 'web',
      'x-client-version': '1.0.0',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Failed to fetch from DeepSeek: ${response.status} ${response.statusText} - ${errText}`);
  }

  return { stream: response.body, headers, uiSessionId: chatSessionId };
}
