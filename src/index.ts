import { startBot } from './bot';

console.log('🤖 Starting Personal WhatsApp AI Assistant...');
console.log('   Powered by Google Gemini\n');

startBot().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
