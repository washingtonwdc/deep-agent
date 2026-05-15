import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', err => console.log('ERROR:', err.message));
  
  await page.goto('http://localhost:3000');
  await page.waitForTimeout(1000);
  
  console.log('Typing goal...');
  await page.fill('#goalInput', 'test');
  await page.click('#runBtn');
  
  await page.waitForTimeout(2000);
  console.log('Done');
  await browser.close();
})();
