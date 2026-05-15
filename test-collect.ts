import { initPlaywright } from './src/services/playwright.ts';
import { runAgent } from './src/services/agent.ts';
import * as dotenv from 'dotenv';
dotenv.config();

(async () => {
  try {
    await initPlaywright(false);
    console.log('Running agent loop...');
    for await (const event of runAgent('diga oi', 1)) {
       console.log('EVENT:', JSON.stringify(event));
    }
    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('FATAL:', err);
    process.exit(1);
  }
})();
