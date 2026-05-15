import { chromium } from 'playwright';
import path from 'path';

(async () => {
  const browser = await chromium.launchPersistentContext(path.resolve('../../deepseek_profile'), { headless: true });
  const page = browser.pages()[0] || await browser.newPage();
  await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  
  await page.screenshot({ path: 'ds-screenshot.png', fullPage: true });
  console.log('Screenshot saved to ds-screenshot.png');
  
  await browser.close();
})();
