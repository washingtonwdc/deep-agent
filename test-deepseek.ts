import { createDeepSeekStream } from './src/services/deepseek.ts';
import { initPlaywright } from './src/services/playwright.ts';
import * as dotenv from 'dotenv';
dotenv.config();

(async () => {
  try {
    await initPlaywright(false);
    console.log('Fetching stream...');
    const { stream } = await createDeepSeekStream('diga oi', false, null);
    
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      console.log(decoder.decode(value, { stream: true }));
    }
    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
