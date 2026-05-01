import { startBot } from './bot';

console.log('🗞️  Starting Alresala School Newspaper WhatsApp Bot...');
console.log('   Powered by Claude AI\n');

startBot().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
