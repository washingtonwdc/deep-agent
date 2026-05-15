import { activePage } from './playwright.ts';

interface CommandResult {
  action: string;
  message: string;
  success: boolean;
}

function extractContent(cmd: string, ...prefixes: string[]): string {
  for (const prefix of prefixes) {
    const lower = cmd.toLowerCase();
    const idx = lower.indexOf(prefix);
    if (idx !== -1) {
      return cmd.slice(idx + prefix.length).trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return '';
}

export async function parseAndExecuteCommand(command: string): Promise<CommandResult> {
  const cmd = command.trim();
  const lower = cmd.toLowerCase();
  const page = activePage;

  if (!page) {
    return { action: 'error', message: 'Navegador não inicializado', success: false };
  }

  try {
    // 1. Enviar mensagem ao chat (deve vir ANTES de 'enter' para evitar conflito)
    const sendChatMatch = lower.match(/^(?:enviar|send):\s*(.+)/);
    if (sendChatMatch) {
      const message = cmd.slice(cmd.indexOf(':') + 1).trim();
      const chatInputSelector = '#chat-input, textarea, [contenteditable="true"]';
      const inputLocator = page.locator(chatInputSelector).first();
      await inputLocator.click();
      await inputLocator.fill(''); // clear if there's old text
      await page.keyboard.insertText(message);
      await page.waitForTimeout(200); // small delay for React state update
      await page.keyboard.press('Enter', { delay: 100 });
      return { action: 'send', message: `✓ Mensagem enviada: "${message}"`, success: true };
    }

    // 2. Navegar para URL
    if (/^(ir para |abrir |go to |navigate to )/i.test(lower)) {
      const url = extractContent(cmd, 'ir para ', 'abrir ', 'go to ', 'navigate to ');
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded' });
      return { action: 'navigate', message: `✓ Navegado para ${fullUrl}`, success: true };
    }

    // 3. Clicar em elemento
    const clickMatch = lower.match(/^(?:clicar em|click on|click)\s+(.+)/);
    if (clickMatch) {
      const selector = cmd.slice(cmd.search(/(?:clicar em|click on|click)\s/i) + clickMatch[0].indexOf(clickMatch[1])).trim().replace(/^['"]|['"]$/g, '');
      await page.click(selector);
      return { action: 'click', message: `✓ Clicado em "${selector}"`, success: true };
    }

    // 4. Digitar texto
    const typeMatch = lower.match(/^(?:digitar|type|escrever)\s+(.+)/);
    if (typeMatch) {
      const text = cmd.slice(cmd.search(/(?:digitar|type|escrever)\s/i)).replace(/^(?:digitar|type|escrever)\s+/i, '').replace(/^['"]|['"]$/g, '');
      const inputSelector = 'textarea, input[type="text"], input:not([type])';
      await page.fill(inputSelector, text);
      return { action: 'type', message: `✓ Digitado: "${text}"`, success: true };
    }

    // 5. Scroll
    if (/scroll|rolar/.test(lower)) {
      if (/para baixo|down/.test(lower)) {
        await page.keyboard.press('PageDown');
        return { action: 'scroll', message: '✓ Scrollado para baixo', success: true };
      }
      if (/para cima|up/.test(lower)) {
        await page.keyboard.press('PageUp');
        return { action: 'scroll', message: '✓ Scrollado para cima', success: true };
      }
      await page.keyboard.press('PageDown');
      return { action: 'scroll', message: '✓ Scrollado para baixo', success: true };
    }

    // 6. Voltar
    if (/^(voltar|back|página anterior)/.test(lower)) {
      await page.goBack();
      return { action: 'back', message: '✓ Voltado à página anterior', success: true };
    }

    // 7. Avançar
    if (/^(avançar|avancar|forward|próxima página)/.test(lower)) {
      await page.goForward();
      return { action: 'forward', message: '✓ Avançado à próxima página', success: true };
    }

    // 8. Recarregar
    if (/^(recarregar|reload|atualizar)/.test(lower)) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      return { action: 'reload', message: '✓ Página recarregada', success: true };
    }

    // 9. Aguardar — suporta tempo dinâmico: "aguardar 5 segundos"
    if (/^(aguardar|esperar|wait)/.test(lower)) {
      const timeMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:segundo|segundos|s\b|sec|second)/);
      const ms = timeMatch ? Math.round(parseFloat(timeMatch[1]) * 1000) : 2000;
      await page.waitForTimeout(ms);
      return { action: 'wait', message: `✓ Aguardado ${ms / 1000}s`, success: true };
    }

    // 10. Pressionar Enter
    if (/^(enter|pressionar enter|press enter)/.test(lower)) {
      await page.keyboard.press('Enter');
      return { action: 'enter', message: '✓ Enter pressionado', success: true };
    }

    return {
      action: 'unknown',
      message: `Comando não reconhecido: "${command}".\nTente:\n• ir para [URL]\n• clicar em [seletor]\n• digitar "[texto]"\n• enviar: [mensagem]\n• enter\n• voltar / avançar / recarregar\n• scroll para baixo / para cima\n• aguardar [N] segundos`,
      success: false,
    };
  } catch (error) {
    return {
      action: 'error',
      message: `✗ Erro ao executar: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      success: false,
    };
  }
}
