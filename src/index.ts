/*
 * File: index.ts
 * Project: deepsproxy
 * Author: Pedro Farias
 * Created: 2026-05-09
 * 
 * Last Modified: Sat May 09 2026
 * Modified By: Pedro Farias
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { chatCompletions } from './routes/chat.ts';
import { parseAndExecuteCommand } from './services/command-parser.ts';
import * as dotenv from 'dotenv';
import { activePage, ensureActivePage, initPlaywright, openAutomationPage, setDeepSeekPage, openUIPage } from './services/playwright.ts';
import { takeScreenshot } from './services/browser-tools.ts';
import { runAgent } from './services/agent.ts';
import { registerBrowserTools } from './tools/browser-registry.ts';


dotenv.config();
registerBrowserTools();

export const app = new Hono();

app.use('*', cors());

app.use('*', async (c, next) => {
  const apiKey = process.env.API_KEY;
  if (apiKey) {
    const authHeader = c.req.header('Authorization');
    const xApiKey = c.req.header('X-API-Key');
    const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : xApiKey;
    if (!providedKey || providedKey !== apiKey) {
      return c.json({ error: 'Não autorizado' }, 401);
    }
  }
  await next();
});

function renderPanel() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Deep Agent</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    /* ── Reset & Base ─────────────────────────────────────────────────────── */
    *{box-sizing:border-box;margin:0;padding:0}
    :root{
      --brand-1:#4f46e5;--brand-2:#7c3aed;
      --surface:#ffffff;--surface-2:#f8fafc;--surface-3:#f1f5f9;
      --border:#e2e8f0;--border-focus:#4f46e5;
      --text:#1e293b;--text-2:#475569;--text-3:#64748b;
      --success:#15803d;--success-bg:#f0fdf4;--success-border:#bbf7d0;
      --error:#b91c1c;--error-bg:#fef2f2;--error-border:#fecaca;
      --info:#1d4ed8;--info-bg:#eff6ff;--info-border:#bfdbfe;
      --thinking-bg:#fafafa;--thinking-border:#e2e8f0;--thinking-text:#475569;
    }
    body{font-family:'Inter',sans-serif;background:var(--surface-2);color:var(--text);height:100vh;overflow:hidden;display:flex;flex-direction:column}

    /* ── Top Bar ──────────────────────────────────────────────────────────── */
    .top-bar{background:var(--surface);border-bottom:1px solid var(--border);padding:10px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0;box-shadow:0 1px 3px rgba(0,0,0,.04)}
    .logo{font-size:16px;font-weight:700;background:linear-gradient(135deg,var(--brand-1),var(--brand-2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-.3px}
    .badge{background:#ede9fe;border:1px solid #ddd6fe;color:#5b21b6;font-size:10px;padding:2px 8px;border-radius:20px;font-weight:600;letter-spacing:.3px;cursor:default}
    .badge[title]{cursor:help}
    .spacer{flex:1}
    .top-actions{display:flex;gap:8px;align-items:center}
    .icon-btn{background:transparent;border:1px solid var(--border);color:var(--text-3);font-size:11px;padding:5px 10px;border-radius:8px;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:5px;white-space:nowrap}
    .icon-btn:hover{border-color:var(--text-3);color:var(--text-2);background:var(--surface-2)}
    .icon-btn:focus-visible{outline:2px solid var(--brand-1);outline-offset:2px}
    /* turn counter */
    #turnBadge{background:var(--info-bg);border:1px solid var(--info-border);color:var(--info);font-size:10px;padding:2px 8px;border-radius:20px;font-weight:600;display:none}

    /* ── Layout ───────────────────────────────────────────────────────────── */
    .layout{display:flex;flex:1;overflow:hidden}
    /* Splitter */
    .splitter{width:5px;background:var(--border);cursor:col-resize;flex-shrink:0;position:relative;transition:background .15s}
    .splitter::after{content:'';position:absolute;inset:-4px 0;z-index:1}
    .splitter:hover,.splitter.dragging{background:var(--brand-1)}

    /* ── Browser Panel ────────────────────────────────────────────────────── */
    .browser-panel{width:62vw;min-width:280px;max-width:85vw;flex:none;display:flex;flex-direction:column;background:var(--surface-3);overflow:hidden}
    .browser-bar{display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0}
    .browser-dots{display:flex;gap:5px;flex-shrink:0}
    .browser-dot{width:11px;height:11px;border-radius:50%}
    .browser-dot.red{background:#ff5f57}.browser-dot.yellow{background:#ffbd2e}.browser-dot.green{background:#28c840}
    .browser-url-bar{flex:1;background:var(--surface-3);border:1px solid var(--border);border-radius:8px;padding:5px 12px;font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default;min-width:0;font-family:ui-monospace,monospace}
    /* status pill */
    .browser-status{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-3);flex-shrink:0}
    .browser-status-dot{width:7px;height:7px;border-radius:50%;background:var(--border);transition:background .3s;flex-shrink:0}
    .browser-status-dot.loading{background:#f59e0b;animation:pulse 1.2s ease-in-out infinite}
    .browser-status-dot.done{background:#22c55e}
    @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}
    .browser-viewport{flex:1;overflow:hidden;display:flex;align-items:stretch;position:relative;background:#dde3ea}
    .browser-viewport img{width:100%;height:100%;object-fit:contain;display:block}
    
    .browser-thinking{height:180px;background:#f8fafc;border-top:1.5px solid var(--border);display:flex;flex-direction:column;overflow:hidden;flex-shrink:0}
    .browser-thinking-header{padding:8px 14px;font-size:11px;font-weight:600;color:var(--text-3);background:var(--surface);border-bottom:1px solid var(--surface-3);display:flex;align-items:center;gap:6px;text-transform:uppercase;letter-spacing:0.5px}
    .browser-thinking-header svg{color:var(--brand-1)}
    .browser-thinking-content{flex:1;overflow-y:auto;padding:12px 14px;font-size:13px;line-height:1.6;color:var(--text-2);white-space:pre-wrap;font-family:inherit;scroll-behavior:smooth}
    .browser-thinking-content::-webkit-scrollbar{width:5px}
    .browser-thinking-content::-webkit-scrollbar-thumb{background:var(--border);border-radius:6px}
    /* Empty state */
    .no-screen{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:13px;flex-direction:column;gap:14px;padding:20px;text-align:center}
    .no-screen-icon{width:56px;height:56px;background:var(--surface);border-radius:16px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.08)}
    .no-screen-icon svg{opacity:.5}
    .no-screen strong{color:var(--text-2);font-size:14px;font-weight:600}
    .no-screen span{font-size:12px;max-width:220px;line-height:1.5}

    /* ── Agent Panel ──────────────────────────────────────────────────────── */
    .agent-panel{flex:1;min-width:300px;display:flex;flex-direction:column;background:var(--surface);overflow:hidden}
    .agent-header{padding:14px 18px 12px;border-bottom:1px solid var(--surface-3);flex-shrink:0;display:flex;align-items:center;gap:10px}
    .agent-header-text{flex:1}
    .agent-title{font-size:17px;font-weight:700;background:linear-gradient(135deg,var(--brand-1),var(--brand-2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-.3px}
    .agent-subtitle{font-size:11px;color:var(--text-3);margin-top:2px}
    /* spinner in header */
    .spinner{width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--brand-1);border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0;display:none}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
    .spinner.active{display:block}

    .agent-messages{flex:1;overflow-y:auto;padding:14px 10px 14px 14px;display:flex;flex-direction:column;gap:8px;background:#fafbfc;scroll-behavior:smooth}
    .agent-messages::-webkit-scrollbar{width:5px}
    .agent-messages::-webkit-scrollbar-thumb{background:var(--border);border-radius:6px}
    .agent-messages::-webkit-scrollbar-thumb:hover{background:#94a3b8}

    /* ── Message bubbles ──────────────────────────────────────────────────── */
    .msg{display:flex;flex-direction:column;gap:3px;animation:fadeIn .18s ease}
    @keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}

    /* user */
    .msg-user .bubble{background:linear-gradient(135deg,var(--brand-1),var(--brand-2));border-radius:16px 16px 4px 16px;padding:10px 14px;font-size:13px;align-self:flex-end;max-width:92%;color:#fff;box-shadow:0 2px 10px rgba(79,70,229,.22);line-height:1.5;word-break:break-word}

    /* status row */
    .msg-status .bubble{background:transparent;color:var(--text-3);font-size:11px;padding:1px 2px;display:flex;align-items:center;gap:5px}
    .msg-status .bubble::before{content:'';display:inline-block;width:3px;height:3px;border-radius:50%;background:currentColor;flex-shrink:0}

    /* thinking — collapsible */
    .msg-thinking .think-toggle{background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-3);padding:0;font-family:inherit;transition:color .2s}
    .msg-thinking .think-toggle:hover{color:var(--text-2)}
    .msg-thinking .think-toggle:focus-visible{outline:2px solid var(--brand-1);outline-offset:2px;border-radius:4px}
    .msg-thinking .think-toggle svg{transition:transform .2s}
    .msg-thinking .think-toggle.open svg{transform:rotate(90deg)}
    .msg-thinking .think-body{background:var(--thinking-bg);border:1px solid var(--thinking-border);border-radius:10px;padding:10px 13px;font-size:12px;color:var(--thinking-text);line-height:1.6;margin-top:5px;white-space:pre-wrap;word-break:break-word;display:none}
    .msg-thinking .think-body.open{display:block}

    /* action */
    .msg-action .bubble{background:var(--info-bg);border:1px solid var(--info-border);border-radius:10px;padding:8px 13px;font-size:12px;color:var(--info);max-width:100%;display:flex;flex-direction:column;gap:4px}
    .tool-header{display:flex;align-items:center;gap:6px;font-weight:600}
    .tool-icon{font-size:13px}
    .tool-name{color:var(--info)}
    .tool-args-list{display:flex;flex-direction:column;gap:3px;margin-top:2px;padding-top:5px;border-top:1px solid rgba(147,197,253,.4)}
    .tool-arg{display:flex;gap:6px;font-size:11px;color:var(--text-3)}
    .tool-arg-key{font-weight:600;color:var(--text-2);flex-shrink:0;min-width:60px}
    .tool-arg-val{word-break:break-all}

    /* result */
    .msg-result .bubble{background:var(--success-bg);border:1px solid var(--success-border);border-radius:10px;padding:8px 13px;font-size:12px;color:var(--success);max-width:100%;line-height:1.5;word-break:break-word}
    .msg-result.err .bubble{background:var(--error-bg);border-color:var(--error-border);color:var(--error)}

    /* done — with copy btn */
    .msg-done .bubble{background:linear-gradient(135deg,var(--success-bg),#dcfce7);border:1px solid #86efac;border-radius:12px;padding:12px 14px;font-size:13px;color:var(--success);max-width:100%;font-weight:500;box-shadow:0 2px 8px rgba(22,163,74,.08);position:relative;line-height:1.6;word-break:break-word;padding-right:40px}
    .msg-done .copy-btn{position:absolute;top:8px;right:8px;background:rgba(255,255,255,.7);border:1px solid var(--success-border);border-radius:6px;width:26px;height:26px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;color:var(--success)}
    .msg-done .copy-btn:hover{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.1)}
    .msg-done .copy-btn:focus-visible{outline:2px solid var(--brand-1);outline-offset:2px}

    /* error */
    .msg-error .bubble{background:var(--error-bg);border:1px solid var(--error-border);border-radius:10px;padding:10px 13px;font-size:12px;color:var(--error);max-width:100%;line-height:1.5}

    /* ── Input area ───────────────────────────────────────────────────────── */
    .agent-input{padding:12px 12px 12px 14px;border-top:1px solid var(--surface-3);flex-shrink:0;background:var(--surface)}
    .input-wrap{display:flex;gap:8px;align-items:flex-end}
    #goalInput{flex:1;background:var(--surface-2);border:1.5px solid var(--border);border-radius:14px;padding:11px 14px;font-size:13px;font-family:inherit;color:var(--text);resize:none;min-height:44px;max-height:160px;line-height:1.5;outline:0;transition:border .2s,box-shadow .2s;overflow-y:auto}
    #goalInput:focus{border-color:var(--border-focus);background:#fff;box-shadow:0 0 0 3px rgba(79,70,229,.1)}
    #goalInput::placeholder{color:#94a3b8}
    #runBtn{background:linear-gradient(135deg,var(--brand-1),var(--brand-2));color:#fff;border:0;border-radius:12px;padding:10px 15px;cursor:pointer;font-weight:600;font-size:13px;white-space:nowrap;transition:all .15s;flex-shrink:0;box-shadow:0 2px 8px rgba(79,70,229,.28);display:flex;align-items:center;gap:6px;min-width:90px;justify-content:center}
    #runBtn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 18px rgba(79,70,229,.38)}
    #runBtn:active:not(:disabled){transform:translateY(0)}
    #runBtn:disabled{opacity:.55;cursor:not-allowed;transform:none;box-shadow:none}
    #runBtn:focus-visible{outline:2px solid var(--brand-1);outline-offset:2px}
    #runBtn.running{background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:0 2px 8px rgba(239,68,68,.28)}
    #runBtn.running:hover{box-shadow:0 4px 18px rgba(239,68,68,.38)}
    .input-hint{font-size:10px;color:#94a3b8;margin-top:6px;padding:0 2px;display:flex;justify-content:space-between;align-items:center}
    .memory-indicator{display:flex;align-items:center;gap:4px;font-size:10px;color:var(--success);font-weight:600}
    .memory-indicator.inactive{color:var(--text-3);opacity:0.6}

    /* ── Quick Actions ────────────────────────────────────────────────────── */
    .quick-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;padding-top:12px;border-top:1px dashed var(--border)}
    .action-btn{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:6px 12px;font-size:11px;color:var(--text-2);cursor:pointer;display:flex;align-items:center;gap:6px;transition:all .2s;font-weight:500}
    .action-btn:hover{background:var(--surface-2);border-color:var(--brand-1);color:var(--brand-1);transform:translateY(-1px);box-shadow:0 2px 5px rgba(0,0,0,.05)}
    .action-btn svg{width:14px;height:14px;flex-shrink:0}

    /* ── Sep line ─────────────────────────────────────────────────────────── */
    .sep{text-align:center;font-size:10px;color:var(--border);padding:4px 0;user-select:none}

    /* ── Tooltip ──────────────────────────────────────────────────────────── */
    [title]{cursor:help}

    /* ── Responsive: stack panels vertically on narrow screens ───────────── */
    @media(max-width:640px){
      .layout{flex-direction:column}
      .browser-panel{width:100%!important;max-width:100%;min-height:40vh;border-right:none;border-bottom:1px solid var(--border)}
      .splitter{display:none}
      .agent-panel{min-width:0}
    }
  </style>
</head>
<body>
  <!-- Top bar -->
  <header class="top-bar" role="banner">
    <span class="logo" aria-label="Deep Agent">⚡ Deep Agent</span>
    <span class="badge" title="Modelo: DeepSeek — via proxy local">DeepSeek</span>
    <span class="badge" title="Versão atualizada com as últimas correções do input" style="background:#dcfce7;border-color:#bbf7d0;color:#166534">v1.1.1</span>
    <div class="spacer"></div>
    <div class="top-actions">
      <span id="turnBadge" aria-live="polite" aria-atomic="true"></span>
      <button class="icon-btn" id="restartBtn" aria-label="Reiniciar servidor" title="Reinicia o processo Node (recarrega as alterações de código)" style="color:#b45309;border-color:#fde68a">
        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 9A8 8 0 0 0 4.93 4.93M4 15a8 8 0 0 0 15.07 4.07" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Reiniciar
      </button>
      <button class="icon-btn" id="clearBtn" aria-label="Limpar histórico de mensagens">
        <svg width="12" height="12" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Limpar
      </button>
    </div>
  </header>

  <div class="layout" role="main">
    <!-- Browser Viewport -->
    <section class="browser-panel" aria-label="Painel do navegador automatizado">
      <div class="browser-bar">
        <div class="browser-dots" aria-hidden="true">
          <div class="browser-dot red"></div>
          <div class="browser-dot yellow"></div>
          <div class="browser-dot green"></div>
        </div>
        <div class="browser-url-bar" id="urlBar" role="status" aria-label="URL atual do navegador">about:blank</div>
        <div class="browser-status" aria-live="polite">
          <div class="browser-status-dot" id="statusDot" role="img" aria-label="Estado: pronto"></div>
          <span id="statusLabel" style="font-size:10px">Pronto</span>
        </div>
      </div>
      <div class="browser-viewport">
        <div class="no-screen" id="noScreen" role="status" aria-label="Nenhuma captura de tela disponível">
          <div class="no-screen-icon" aria-hidden="true">
            <svg width="28" height="28" fill="none" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 20h8M12 18v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
          <strong>Navegador em espera</strong>
          <span>O agente vai capturar a tela assim que iniciar a automação.</span>
        </div>
        <img id="screenImg" style="display:none" alt="Captura de tela atual do navegador automatizado" />
      </div>
      <!-- Nova área de pensamento abaixo do preview -->
      <div class="browser-thinking" id="thinkingArea">
        <div class="browser-thinking-header">
          <svg width="12" height="12" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>
          Monitor de Raciocínio
        </div>
        <div class="browser-thinking-content" id="thinkingContent">O agente ainda não iniciou o processamento...</div>
      </div>
    </section>

    <!-- Drag splitter -->
    <div class="splitter" id="splitter" role="separator" aria-label="Redimensionar painéis" tabindex="0" aria-valuenow="62" aria-valuemin="20" aria-valuemax="85"></div>

    <!-- Agent Chat -->
    <section class="agent-panel" aria-label="Painel do agente">
      <div class="agent-header">
        <div class="agent-header-text">
          <div class="agent-title">Deep Agent</div>
          <div class="agent-subtitle">Automação de navegador com IA</div>
        </div>
        <div class="spinner" id="headerSpinner" aria-hidden="true"></div>
      </div>
      <div class="agent-messages" id="messages" role="log" aria-live="polite" aria-label="Mensagens do agente"></div>
      <div class="agent-input">
        <div class="input-wrap">
          <textarea id="goalInput" rows="1"
            placeholder="Descreva o que o agente deve fazer…"
            aria-label="Objetivo para o agente executar"
            aria-multiline="true"></textarea>
          <button id="runBtn" aria-label="Executar ou parar objetivo">
            <div class="btn-spinner" aria-hidden="true"></div>
            <span class="btn-label">▶ Executar</span>
          </button>
        </div>
        <div class="input-hint" aria-hidden="true">
          <span>Enter para enviar · Shift+Enter para nova linha</span>
          <div class="memory-indicator" id="memoryIndicator" title="O histórico de conversas está sendo persistido em disco">
            <svg width="10" height="10" fill="currentColor" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"/></svg>
            Memória Ativa
          </div>
        </div>
        
        <div class="quick-actions" id="quickActions">
          <button class="action-btn" data-goal="vai no gmail">
            <span>📧</span> Gmail
          </button>
          <button class="action-btn" data-goal="pesquisa iphone no mercado livre">
            <span>📦</span> M. Livre
          </button>
          <button class="action-btn" data-goal="abrir google">
            <span>🔍</span> Google
          </button>
          <button class="action-btn" data-goal="vai no youtube">
            <span>🎬</span> YouTube
          </button>
          <button class="action-btn" data-goal="mostra meu linkedin">
            <span>👤</span> LinkedIn
          </button>
          <button class="action-btn" data-goal="verificar notícias no g1">
            <span>📰</span> Notícias
          </button>
        </div>
      </div>
    </section>
  </div>

  <script>
    /* ── DOM refs ─────────────────────────────────────────────────────────── */
    const msgsEl      = document.getElementById('messages');
    const goalInput   = document.getElementById('goalInput');
    const runBtn      = document.getElementById('runBtn');
    const urlBar      = document.getElementById('urlBar');
    const thinkingContent = document.getElementById('thinkingContent');
    const statusDot   = document.getElementById('statusDot');
    const statusLabel = document.getElementById('statusLabel');
    const screenImg   = document.getElementById('screenImg');
    const noScreen    = document.getElementById('noScreen');
    const clearBtn    = document.getElementById('clearBtn');
    const restartBtn  = document.getElementById('restartBtn');
    const turnBadge   = document.getElementById('turnBadge');
    const spinner     = document.getElementById('headerSpinner');
    const splitter    = document.getElementById('splitter');
    const browserPanel = document.querySelector('.browser-panel');

    const HIST_KEY = 'deep-agent-history';
    const MAX_HIST = 150;
    let running = false;
    let screenshotInterval = null;
    let currentTurn = 0;
    let abortController = null;

    /* ── State helpers ───────────────────────────────────────────────────── */
    function setRunning(v) {
      running = v;
      if (v) {
        runBtn.disabled = false;
        runBtn.classList.add('running');
        runBtn.setAttribute('aria-busy', 'true');
        runBtn.innerHTML = '<span class="btn-label">⏹ Parar</span>';
      } else {
        runBtn.disabled = false;
        runBtn.classList.remove('running');
        runBtn.setAttribute('aria-busy', 'false');
        runBtn.innerHTML = '<div class="btn-spinner" aria-hidden="true"></div><span class="btn-label">▶ Executar</span>';
      }
      spinner.classList.toggle('active', v);
      if (!v) { turnBadge.style.display = 'none'; currentTurn = 0; }
    }

    function setBrowserStatus(state) {
      statusDot.className = 'browser-status-dot' + (state === 'loading' ? ' loading' : state === 'done' ? ' done' : '');
      const labels = { loading: 'Navegando…', done: 'Pronto', idle: 'Pronto' };
      statusLabel.textContent = labels[state] || 'Pronto';
      statusDot.setAttribute('aria-label', 'Estado: ' + (labels[state] || 'Pronto'));
    }

    /* ── History ─────────────────────────────────────────────────────────── */
    function loadHist() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; } }
    function saveHist(h) { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(-MAX_HIST))); } catch {} }
    function appendHist(e) { const h = loadHist(); h.push(e); saveHist(h); }

    /* ── Tool args renderer (human-readable key: value table) ────────────── */
    function renderToolArgs(args) {
      if (!args || !Object.keys(args).length) return '';
      const rows = Object.entries(args).map(([k, v]) => {
        const val = typeof v === 'string' ? v : JSON.stringify(v);
        return '<div class="tool-arg"><span class="tool-arg-key">' + escHtml(k) + '</span><span class="tool-arg-val">' + escHtml(val) + '</span></div>';
      }).join('');
      return '<div class="tool-args-list">' + rows + '</div>';
    }

    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    /* ── Tool icon map ───────────────────────────────────────────────────── */
    const TOOL_ICONS = {
      navigate_to:'🌐', click_element:'👆', type_text:'⌨️', press_key:'⌨️',
      scroll_page:'📜', wait_seconds:'⏳', go_back:'⬅️', go_forward:'➡️',
      read_page:'👁️', select_option:'📋', done:'✅',
    };

    /* ── Render a single message entry ───────────────────────────────────── */
    function renderEntry(e) {
      const wrap = document.createElement('div');
      wrap.className = 'msg msg-' + e.type;

      const bub = document.createElement('div');
      bub.className = 'bubble';

      if (e.type === 'action') {
        const icon = TOOL_ICONS[e.tool] || '⚙️';
        bub.innerHTML =
          '<div class="tool-header"><span class="tool-icon" aria-hidden="true">' + icon + '</span>' +
          '<span class="tool-name">' + escHtml(e.tool || '') + '</span></div>' +
          renderToolArgs(e.args);

      } else if (e.type === 'thinking') {
        // Redireciona o pensamento para a área dedicada abaixo do preview
        if (thinkingContent) {
          if (thinkingContent.textContent.includes('ainda não iniciou')) thinkingContent.textContent = '';
          thinkingContent.textContent += (e.text || '');
          thinkingContent.scrollTop = thinkingContent.scrollHeight;
        }
        return null; // Não cria bolha no chat

      } else if (e.type === 'done') {
        bub.textContent = e.text || '';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.title = 'Copiar resposta';
        copyBtn.setAttribute('aria-label', 'Copiar resposta final');
        copyBtn.innerHTML = '<svg width="12" height="12" fill="none" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/></svg>';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(e.text || '').then(() => {
            copyBtn.innerHTML = '<svg width="12" height="12" fill="none" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            setTimeout(() => {
              copyBtn.innerHTML = '<svg width="12" height="12" fill="none" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/></svg>';
            }, 2000);
          });
        });
        bub.appendChild(copyBtn);

      } else {
        bub.textContent = e.text || '';
      }

      if (e.type === 'result' && e.text && e.text.startsWith('✗')) wrap.classList.add('err');
      if (e.type !== 'thinking') wrap.appendChild(bub);
      msgsEl.appendChild(wrap);
      msgsEl.scrollTop = msgsEl.scrollHeight;
      return wrap;
    }

    /* ── Add + persist ───────────────────────────────────────────────────── */
    function addMsg(e, persist = true) {
      renderEntry(e);
      if (persist) appendHist(e);
    }

    /* ── Screenshot polling ──────────────────────────────────────────────── */
    function startScreenshots() {
      stopScreenshots();
      screenshotInterval = setInterval(async () => {
        try {
          const res = await fetch('/api/browser/screenshot');
          if (!res.ok) return;
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          screenImg.onload = () => URL.revokeObjectURL(url);
          screenImg.src = url;
          screenImg.style.display = 'block';
          noScreen.style.display = 'none';
        } catch {}
        try {
          const st = await fetch('/api/browser/state').then(r => r.json());
          if (st.url) urlBar.textContent = st.url;
          if (st.title) urlBar.title = st.title;
        } catch {}
      }, 900);
    }
    function stopScreenshots() {
      if (screenshotInterval) { clearInterval(screenshotInterval); screenshotInterval = null; }
    }

    /* ── Run the agent ───────────────────────────────────────────────────── */
    async function runAgent(goal) {
      if (!goal.trim()) return;
      if (running) {
        // Se já está rodando, parar
        if (abortController) {
          abortController.abort();
          addMsg({ type: 'status', text: '⏹ Resposta cancelada pelo usuário.' }, false);
        }
        setRunning(false);
        setBrowserStatus('idle');
        return;
      }
      setRunning(true);
      setBrowserStatus('loading');
      addMsg({ type: 'user', text: goal });
      goalInput.value = '';
      goalInput.style.height = '';
      startScreenshots();

      let statusEl = null;
      
      // Criar novo AbortController para esta execução
      abortController = new AbortController();

      try {
        const resp = await fetch('/api/agent/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal }),
          signal: abortController.signal,
        });

        if (!resp.ok) {
          addMsg({ type: 'error', text: '✗ Erro do servidor: ' + resp.status });
          return;
        }

        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = '';

        while (true) {
          try {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split('\\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const raw = line.slice(6);
              if (raw === '[DONE]') break;
              try {
                const ev = JSON.parse(raw);
                if (ev.type === 'status') {
                  if (statusEl) statusEl.remove();
                  statusEl = renderEntry({ type: 'status', text: ev.text });
                  /* extract turn number if present */
                  const m = (ev.text || '').match(/Turno (\d+)/);
                  if (m) {
                    currentTurn = parseInt(m[1]);
                    turnBadge.textContent = 'Turno ' + currentTurn;
                    turnBadge.style.display = '';
                  }
                } else if (ev.type === 'thinking') {
                  renderEntry(ev);
                } else {
                  if (statusEl) { statusEl.remove(); statusEl = null; }
                  addMsg(ev);
                }
              } catch {}
            }
          } catch (readerErr) {
            if (readerErr.name === 'AbortError') {
              break;
            }
            throw readerErr;
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          addMsg({ type: 'error', text: '✗ Falha na conexão: ' + err.message });
        }
      } finally {
        setRunning(false);
        setBrowserStatus('done');
        setTimeout(() => setBrowserStatus('idle'), 3000);
        abortController = null;
      }
    }

    /* ── Input auto-resize ───────────────────────────────────────────────── */
    goalInput.addEventListener('input', () => {
      goalInput.style.height = 'auto';
      goalInput.style.height = Math.min(goalInput.scrollHeight, 140) + 'px';
    });
    goalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!running) runAgent(goalInput.value.trim()); }
    });
    runBtn.addEventListener('click', () => {
      if (running) {
        runAgent(''); // Disparar parada
      } else {
        runAgent(goalInput.value.trim());
      }
    });

    /* ── Quick Actions ────────────────────────────────────────────────────── */
    document.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const goal = btn.getAttribute('data-goal');
        if (goal) {
          goalInput.value = goal;
          goalInput.dispatchEvent(new Event('input'));
          runAgent(goal);
        }
      });
    });

    /* ── Restart server ──────────────────────────────────────────────────── */
    restartBtn.addEventListener('click', async () => {
      if (!confirm('Reiniciar o servidor? A página será recarregada em seguida.')) return;
      restartBtn.disabled = true;
      restartBtn.textContent = '⏳ Reiniciando…';
      try {
        await fetch('/api/server/restart', { method: 'POST' });
      } catch {}
      setTimeout(() => location.reload(), 3000);
    });

    /* ── Clear ───────────────────────────────────────────────────────────── */
    clearBtn.addEventListener('click', () => {
      localStorage.removeItem(HIST_KEY);
      msgsEl.innerHTML = '';
      addMsg({ type: 'status', text: 'Histórico limpo.' }, false);
    });

    /* ── Restore history ─────────────────────────────────────────────────── */
    const hist = loadHist();
    if (hist.length === 0) {
      addMsg({ type: 'status', text: '👋 Olá! Descreva o que o agente deve fazer e pressione Executar.' }, false);
    } else {
      hist.forEach(e => renderEntry(e));
      const sep = document.createElement('div');
      sep.className = 'sep'; sep.textContent = '— sessão anterior restaurada —';
      msgsEl.appendChild(sep);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    /* ── Drag splitter ───────────────────────────────────────────────────── */
    let dragging = false;
    splitter.addEventListener('mousedown', (e) => { dragging = true; splitter.classList.add('dragging'); e.preventDefault(); });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const layout = document.querySelector('.layout');
      const rect = layout.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(85, Math.max(20, pct));
      browserPanel.style.width = clamped + '%';
      splitter.setAttribute('aria-valuenow', Math.round(clamped));
    });
    window.addEventListener('mouseup', () => { dragging = false; splitter.classList.remove('dragging'); });
    /* keyboard resize */
    splitter.addEventListener('keydown', (e) => {
      const current = parseFloat(browserPanel.style.width) || 62;
      if (e.key === 'ArrowLeft') browserPanel.style.width = Math.max(20, current - 5) + '%';
      if (e.key === 'ArrowRight') browserPanel.style.width = Math.min(85, current + 5) + '%';
    });

    /* ── Start ───────────────────────────────────────────────────────────── */
    setRunning(false);  // garante estado limpo ao carregar
    startScreenshots();
    goalInput.focus();
  </script>
</body>
</html>`;
}

app.get('/health', (c) => c.json({ status: 'ok' }));

app.post('/api/server/restart', (c) => {
  setTimeout(() => process.exit(0), 300);
  return c.json({ restarting: true });
});

app.get('/', (c) => c.html(renderPanel()));

// Screenshot of the automation tab
app.get('/api/browser/screenshot', async (c) => {
  const buf = await takeScreenshot();
  if (!buf) return c.body(null, 204);
  return c.body(buf as unknown as ReadableStream, 200, {
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'no-store',
  });
});

// Agentic run — streams SSE events
app.post('/api/agent/run', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'JSON inválido' }, 400); }
  const { goal, maxTurns = 20 } = body || {};
  if (!goal || typeof goal !== 'string') return c.json({ error: 'Objetivo obrigatório' }, 400);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        for await (const event of runAgent(goal, maxTurns)) {
          send(event);
        }
      } catch (err: any) {
        send({ type: 'error', text: err?.message ?? String(err) });
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return c.body(stream as unknown as ReadableStream, 200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });
});

app.get('/api/browser/state', async (c) => {
  const page = activePage;
  if (!page) {
    return c.json({ ready: false, url: '', title: '' });
  }

  return c.json({
    ready: true,
    url: page.url(),
    title: await page.title(),
  });
});

app.post('/api/browser/command', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch (err: any) {
    console.error('Failed to parse JSON body for /api/browser/command:', err?.message || err);
    return c.json({ message: 'JSON inválido', success: false }, 400);
  }

  const { command } = body || {};
  if (!command || typeof command !== 'string') {
    return c.json({ message: 'Comando inválido', success: false }, 400);
  }

  try {
    const result = await parseAndExecuteCommand(command);
    return c.json(result);
  } catch (err: any) {
    console.error('Error executing command:', err?.stack || err);
    return c.json({ action: 'error', message: `✗ Erro interno: ${err?.message || 'indefinido'}`, success: false, stack: err?.stack || null }, 500);
  }
});

app.post('/api/browser/navigate', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch (err) {
    return c.json({ message: 'JSON inválido' }, 400);
  }

  const { url } = body || {};
  if (!url || typeof url !== 'string') {
    return c.json({ error: 'URL inválida' }, 400);
  }

  const page = await ensureActivePage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return c.json({ ok: true, url: page.url() });
});

app.post('/api/browser/click', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch (err) {
    return c.json({ message: 'JSON inválido' }, 400);
  }

  const { selector } = body || {};
  if (!selector || typeof selector !== 'string') {
    return c.json({ error: 'Seletor inválido' }, 400);
  }

  const page = await ensureActivePage();
  await page.click(selector);
  return c.json({ ok: true, selector });
});

app.post('/api/browser/type', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch (err) {
    return c.json({ message: 'JSON inválido' }, 400);
  }

  const { selector, text } = body || {};
  if (!selector || typeof selector !== 'string') {
    return c.json({ error: 'Seletor inválido' }, 400);
  }
  if (typeof text !== 'string') {
    return c.json({ error: 'Texto inválido' }, 400);
  }

  const page = await ensureActivePage();
  await page.fill(selector, text);
  return c.json({ ok: true, selector });
});

app.post('/api/browser/chat/send', async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch (err) {
    return c.json({ message: 'JSON inválido' }, 400);
  }

  const { instruction } = body || {};
  if (!instruction || typeof instruction !== 'string') {
    return c.json({ error: 'Instrução inválida' }, 400);
  }

  const page = await ensureActivePage();
  const onDeepSeek = page.url().includes('chat.deepseek.com');
  if (!onDeepSeek) {
    await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
  }

  const chatInputSelector = '#chat-input, textarea, [contenteditable="true"]';
  await page.waitForSelector(chatInputSelector, { timeout: 30000 });
  const inputLocator = page.locator(chatInputSelector).first();
  await inputLocator.click();
  await inputLocator.fill('');
  await page.keyboard.insertText(instruction);
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter', { delay: 100 });

  return c.json({ ok: true, message: 'Instrução enviada ao chat' });
});

app.post('/api/browser/back', async (c) => {
  const page = await ensureActivePage();
  await page.goBack();
  return c.json({ ok: true, message: 'voltou' });
});

app.post('/api/browser/forward', async (c) => {
  const page = await ensureActivePage();
  await page.goForward();
  return c.json({ ok: true, message: 'avançou' });
});

app.post('/api/browser/reload', async (c) => {
  const page = await ensureActivePage();
  await page.reload({ waitUntil: 'domcontentloaded' });
  return c.json({ ok: true, message: 'recarregado' });
});

app.post('/api/browser/enter', async (c) => {
  const page = await ensureActivePage();
  await page.keyboard.press('Enter');
  return c.json({ ok: true, message: 'enter enviado' });
});

// OpenAI compatible routes
app.post('/v1/chat/completions', chatCompletions);

app.get('/v1/models', (c) => {
  return c.json({
    object: 'list',
    data: [
      {
        id: 'deepseek-thinking',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'deepseek',
        permission: [],
        root: 'deepseek-thinking',
        parent: null,
      },
      {
        id: 'deepseek-no-thinking',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'deepseek',
        permission: [],
        root: 'deepseek-no-thinking',
        parent: null,
      }
    ]
  });
});

// Initialize playwright when server starts
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { logger } from './utils/logger.ts';

async function startServerWithRetry(startPort: number, maxAttempts = 20): Promise<number> {
  let candidate = startPort;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const server = serve({
        fetch: app.fetch,
        port: candidate,
      });

      await new Promise<void>((resolve, reject) => {
        server.once('listening', () => resolve());
        server.once('error', reject);
      });

      return candidate;
    } catch (error: any) {
      if (error?.code !== 'EADDRINUSE') {
        throw error;
      }
      candidate += 1;
    }
  }

  throw new Error(`No available port found from ${startPort} to ${candidate - 1}`);
}

function killProcessesOnPort(port: number) {
  try {
    const platform = process.platform;
    logger.debug(`Checking port ${port} for existing processes`, { platform });

    if (platform === 'win32') {
      // netstat -ano | findstr :<port>
      const cmd = `netstat -ano | findstr :${port}`;
      const out = execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
      const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const pids = new Set<number>();
      for (const line of lines) {
        const parts = line.split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
      }
      for (const pid of pids) {
        try {
          logger.info(`Killing process ${pid} on port ${port}`);
          execSync(`taskkill /PID ${pid} /F`);
        } catch (e: any) {
          logger.warn(`Failed to kill PID ${pid}`, { message: e?.message || e });
        }
      }
    } else {
      // unix-like: use lsof to find PIDs
      try {
        const out = execSync(`lsof -i :${port} -t`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
        const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        for (const pidStr of lines) {
          const pid = parseInt(pidStr, 10);
          if (!isNaN(pid) && pid > 0 && pid !== process.pid) {
            try {
              logger.info(`Killing process ${pid} on port ${port}`);
              process.kill(pid, 'SIGKILL');
            } catch (e: any) {
              logger.warn(`Failed to kill PID ${pid}`, { message: e?.message || e });
            }
          }
        }
      } catch (e: any) {
        // lsof may not be available; try fuser
        try {
          const out2 = execSync(`fuser -k ${port}/tcp`, { stdio: ['pipe', 'pipe', 'ignore'] }).toString();
          logger.debug('fuser output', { out: out2 });
        } catch (e2: any) {
          logger.warn('No lsof/fuser available or no processes found on port', { port });
        }
      }
    }
  } catch (err: any) {
    logger.warn('Error while attempting to kill processes on port', { port, message: err?.message || err });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const configuredPort = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  try { killProcessesOnPort(configuredPort); } catch (e: any) {
    logger.warn('Failed during port cleanup', { message: e?.message || e });
  }
  const port = await startServerWithRetry(configuredPort);
  if (port !== configuredPort) {
    logger.warn(`Port ${configuredPort} is in use. Using port ${port} instead.`);
  }
  logger.info(`Server is running on port ${port}`);

  // Playwright startup — non-fatal: server stays up even if browser fails
  try {
    await initPlaywright(false);
    logger.info('Playwright initialized.');
    if (activePage) {
      await activePage.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
      setDeepSeekPage(activePage);
    }
    const autoTab = await openAutomationPage();
    await autoTab.goto('about:blank');
    await openUIPage(`http://localhost:${port}/`);
    logger.info('Tab 0: DeepSeek (PoW) | Tab 1: automação | Tab 2: Painel de Controle');
  } catch (err: any) {
    logger.error('Playwright failed — server running without browser automation', { message: err?.message });
    logger.info(`Open the panel manually at: http://localhost:${port}/`);
  }
}
