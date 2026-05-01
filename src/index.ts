import { createClient, startBot } from './bot';

console.log('🗞️  Starting Alresala School Newspaper WhatsApp Bot...');
console.log('   Powered by Claude AI\n');

const client = createClient();
startBot(client);
