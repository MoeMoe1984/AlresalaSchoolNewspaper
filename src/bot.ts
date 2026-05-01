import qrcode from 'qrcode-terminal';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { clearHistory, getAIResponse } from './claude';
import { config } from './config';

const HELP_TEXT = `🤖 *Personal AI Assistant*

Commands:
• !help — Show this message
• !clear — Reset conversation history

Just send any message and I will reply!
أرسل أي رسالة وسأرد عليك!`;

function isAllowed(jid: string): boolean {
  if (config.allowedNumbers.length === 0) return true;
  return config.allowedNumbers.some(n => jid.startsWith(n));
}

function getTextFromMessage(msg: WAMessage): string | null {
  const content = msg.message;
  if (!content) return null;
  return (
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    null
  );
}

export async function startBot(): Promise<void> {
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState('.baileys_auth');

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      console.log('\n📱 Scan this QR code with WhatsApp on your phone:\n');
      qrcode.generate(qr, { small: true });
      console.log('\nWaiting for scan...\n');
    }

    if (connection === 'close') {
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.log('🔄 Reconnecting...');
        startBot();
      } else {
        console.log('❌ Logged out. Delete .baileys_auth/ and restart to re-scan QR.');
      }
    }

    if (connection === 'open') {
      console.log('✅ Bot is ready and listening for messages!\n');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.key.remoteJid) continue;

      const from = msg.key.remoteJid;

      if (!isAllowed(from)) continue;

      const body = getTextFromMessage(msg)?.trim();
      if (!body) continue;

      if (body.toLowerCase() === '!help') {
        await sock.sendMessage(from, { text: HELP_TEXT });
        continue;
      }

      if (body.toLowerCase() === '!clear') {
        clearHistory(from);
        await sock.sendMessage(from, {
          text: '✅ Conversation history cleared!\nتم مسح سجل المحادثة!',
        });
        continue;
      }

      try {
        await sock.sendPresenceUpdate('composing', from);
        const reply = await getAIResponse(from, body);
        await sock.sendMessage(from, { text: reply });
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Error for ${from}:`, error);
        await sock.sendMessage(from, {
          text: 'Sorry, something went wrong. Please try again.\nعذراً، حدث خطأ. يرجى المحاولة مرة أخرى.',
        });
      }
    }
  });
}
