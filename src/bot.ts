import qrcode from 'qrcode-terminal';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import { clearHistory, getAIResponse } from './claude';
import { config } from './config';

const HELP_TEXT = `🗞️ *Alresala School Newspaper Bot*

Commands:
• !help — Show this message
• !clear — Reset conversation history

Just send any message and I will reply!

---
جريدة الرسالة المدرسية 📰
أرسل أي رسالة وسأرد عليك!`;

export function createClient(): Client {
  return new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });
}

function isAllowed(from: string): boolean {
  if (config.allowedNumbers.length === 0) return true;
  return config.allowedNumbers.some(n => from.startsWith(n));
}

async function handleMessage(message: Message): Promise<void> {
  // Skip messages sent by the bot itself
  if (message.fromMe) return;
  // Skip broadcast / status messages
  if (message.isStatus) return;

  const from = message.from;

  if (!isAllowed(from)) return;

  const body = message.body.trim();
  if (!body) return;

  // Built-in commands
  if (body.toLowerCase() === '!help') {
    await message.reply(HELP_TEXT);
    return;
  }

  if (body.toLowerCase() === '!clear') {
    clearHistory(from);
    await message.reply('✅ Conversation history cleared!\nتم مسح سجل المحادثة!');
    return;
  }

  try {
    const chat = await message.getChat();
    await chat.sendStateTyping();

    const reply = await getAIResponse(from, body);
    await message.reply(reply);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error for ${from}:`, error);
    await message.reply('Sorry, something went wrong. Please try again.\nعذراً، حدث خطأ. يرجى المحاولة مرة أخرى.');
  }
}

export function startBot(client: Client): void {
  client.on('qr', (qr) => {
    console.log('\n📱 Scan this QR code with WhatsApp on your phone:\n');
    qrcode.generate(qr, { small: true });
    console.log('\nWaiting for scan...\n');
  });

  client.on('authenticated', () => {
    console.log('🔐 Authenticated — session saved.');
  });

  client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
    process.exit(1);
  });

  client.on('ready', () => {
    console.log('✅ Bot is ready and listening for messages!\n');
  });

  client.on('disconnected', (reason) => {
    console.warn('⚠️  Disconnected:', reason);
  });

  client.on('message', (msg: Message) => {
    handleMessage(msg).catch(err =>
      console.error('Unhandled message error:', err),
    );
  });

  client.initialize();
}
