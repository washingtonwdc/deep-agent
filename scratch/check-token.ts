import { chromium } from 'playwright';
import path from 'path';

async function check() {
  const profile = path.resolve('deepseek_profile');
  const context = await chromium.launchPersistentContext(profile, { headless: true });
  const page = await context.newPage();
  await page.goto('https://chat.deepseek.com/');
  const token = await page.evaluate(() => localStorage.getItem('userToken'));
  console.log('Token exists:', !!token);
  if (token) console.log('Token snippet:', JSON.parse(token).value?.slice(0, 10));
  await context.close();
}
check();
