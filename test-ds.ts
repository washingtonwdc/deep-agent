import { chromium } from 'playwright';
import path from 'path';

(async () => {
  try {
    const browser = await chromium.launchPersistentContext(path.resolve('../../deepseek_profile'), { headless: false });
    const page = browser.pages()[0] || await browser.newPage();
    await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'ds-screenshot.png', fullPage: true });
    
    const elements = await page.evaluate(() => {
      // Find the chat input
      const chatInputSelector = '#chat-input, textarea, [contenteditable="true"]';
      const inputEl = document.querySelector(chatInputSelector);
      
      // Look for the send button nearby or in the page
      // Usually it's an SVG inside a button or div with role="button" next to the input
      const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
      const possibleSendButtons = buttons.map(b => ({
        className: b.className,
        html: b.innerHTML.slice(0, 100),
        text: b.textContent?.trim()
      })).filter(b => b.html.includes('svg') || b.className.includes('send') || b.className.includes('icon'));
      
      return {
        inputFound: !!inputEl,
        possibleSendButtons,
        userToken: localStorage.getItem('userToken')
      };
    });
    console.log(JSON.stringify(elements, null, 2));
    await browser.close();
  } catch (err) {
    console.error(err);
  }
})();
