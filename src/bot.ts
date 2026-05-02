import qrcode from 'qrcode-terminal';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  getAggregateVotesInPollMessage,
  useMultiFileAuthState,
  WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { config } from './config';

const EMAIL = 'Mohamed.ali@altron.com';

// ── Dubai time ───────────────────────────────────────────────────────────────

function getDubaiContext() {
  const dubai = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const d = dubai.getUTCDay(); // 0=Sun 1=Mon … 6=Sat
  const h = dubai.getUTCHours();
  const isWorkingHours = d >= 1 && d <= 5 && h >= 8 && h < 17;
  const isWeekend =
    (d === 5 && h >= 17) || d === 6 || d === 0 || (d === 1 && h < 8);
  return { isWorkingHours, isWeekend };
}

// ── Language detection ───────────────────────────────────────────────────────

type Lang = 'en' | 'ar';
const detectLang = (text: string): Lang =>
  /[؀-ۿ]/.test(text) ? 'ar' : 'en';

// ── Conversation state ───────────────────────────────────────────────────────

type Step =
  | 'idle'
  | 'awaiting_purpose'
  | 'awaiting_business_option'
  | 'awaiting_meeting_time'
  | 'awaiting_message';

interface Conv { step: Step; lang: Lang }

const convs = new Map<string, Conv>();
const msgStore = new Map<string, WAMessage>();

const getConv = (jid: string): Conv =>
  convs.get(jid) ?? { step: 'idle', lang: 'en' };

// ── Text templates ────────────────────────────────────────────────────────────

const MSG = {
  greeting:        { en: 'Hello, This is the AI assistant of Dr. Mohamed Ali.', ar: 'مرحباً، أنا المساعد الذكي للدكتور محمد علي.' },
  purposeQ:        { en: 'Is this a personal or business matter?', ar: 'هل رسالتك ذات طابع شخصي أم عمل؟' },
  pleaseVote:      { en: 'Please use the poll above to select an option.', ar: 'يرجى الاختيار من الاستطلاع أعلاه.' },
  personalWorking: { en: 'Dr. Mohamed Ali will contact you later after 5 PM.', ar: 'سيتواصل معك الدكتور محمد علي لاحقاً بعد الساعة 5 مساءً.' },
  personalWeekend: { en: 'Dr. Mohamed Ali will contact you on Monday after 8 AM.', ar: 'سيتواصل معك الدكتور محمد علي يوم الاثنين بعد الساعة 8 صباحاً.' },
  businessQ:       { en: 'How can we help you?', ar: 'كيف يمكننا مساعدتك؟' },
  afterHours:      { en: '⚠️ Dr. Mohamed Ali will get back to you on Monday after 8 AM.', ar: '⚠️ سيتواصل معك الدكتور محمد علي يوم الاثنين بعد الساعة 8 صباحاً.' },
  meetingPrompt:   { en: 'Please reply with your preferred date and time and we will confirm it.', ar: 'يرجى إرسال التاريخ والوقت المناسب لك وسنؤكد الموعد.' },
  meetingConfirm:  { en: '✅ Your meeting request has been noted. Dr. Mohamed Ali will confirm shortly.', ar: '✅ تم تسجيل طلب الاجتماع. سيتواصل معك الدكتور محمد علي للتأكيد قريباً.' },
  emailReply:      { en: `📧 Official email of Dr. Mohamed Ali:\n${EMAIL}`, ar: `📧 البريد الإلكتروني الرسمي للدكتور محمد علي:\n${EMAIL}` },
  messagePrompt:   { en: 'Please type your message and I will make sure Dr. Mohamed Ali receives it.', ar: 'يرجى كتابة رسالتك وسأتأكد من إيصالها للدكتور محمد علي.' },
  messageConfirm:  { en: '✅ Your message has been noted and will be forwarded to Dr. Mohamed Ali.', ar: '✅ تم استلام رسالتك وسيتم إرسالها للدكتور محمد علي.' },
  cleared:         { en: 'Conversation reset. Send a message to start again.', ar: 'تمت إعادة المحادثة. أرسل رسالة للبدء من جديد.' },
} as const;

const t = (key: keyof typeof MSG, lang: Lang) => MSG[key][lang];

// ── Poll option labels ────────────────────────────────────────────────────────

const PURPOSE_OPTIONS  = ['👤 Personal / شخصي', '💼 Business / عمل'];
const BUSINESS_OPTIONS = [
  '📅 Schedule a meeting / جدولة اجتماع',
  '📧 Get official email / البريد الإلكتروني',
  '✉️ Leave a message / ترك رسالة',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

type Sock = ReturnType<typeof makeWASocket>;

function isAllowed(jid: string): boolean {
  if (config.allowedNumbers.length === 0) return true;
  return config.allowedNumbers.some(n => jid.startsWith(n));
}

// ── Text message handler ──────────────────────────────────────────────────────

async function handleText(sock: Sock, from: string, text: string): Promise<void> {
  const conv = getConv(from);
  const lang = conv.step === 'idle' ? detectLang(text) : conv.lang;

  if (text.toLowerCase() === '!clear') {
    convs.delete(from);
    await sock.sendMessage(from, { text: t('cleared', lang) });
    return;
  }

  switch (conv.step) {
    case 'idle': {
      convs.set(from, { step: 'awaiting_purpose', lang });
      await sock.sendMessage(from, {
        text: `${t('greeting', lang)}\n\n${t('purposeQ', lang)}`,
      });
      const sent = await sock.sendMessage(from, {
        poll: { name: t('purposeQ', lang), values: PURPOSE_OPTIONS, selectableCount: 1 },
      });
      if (sent?.key.id) msgStore.set(sent.key.id, sent);
      break;
    }

    case 'awaiting_purpose':
    case 'awaiting_business_option':
      await sock.sendMessage(from, { text: t('pleaseVote', conv.lang) });
      break;

    case 'awaiting_meeting_time':
      await sock.sendMessage(from, { text: t('meetingConfirm', conv.lang) });
      convs.set(from, { step: 'idle', lang: conv.lang });
      break;

    case 'awaiting_message':
      await sock.sendMessage(from, { text: t('messageConfirm', conv.lang) });
      convs.set(from, { step: 'idle', lang: conv.lang });
      break;
  }
}

// ── Poll vote handler ─────────────────────────────────────────────────────────

async function handlePollVote(sock: Sock, from: string, selected: string): Promise<void> {
  const conv = getConv(from);
  const lang = conv.lang;
  const { isWorkingHours, isWeekend } = getDubaiContext();

  if (conv.step === 'awaiting_purpose') {
    if (selected.includes('Personal') || selected.includes('شخصي')) {
      const reply = isWorkingHours ? t('personalWorking', lang) : t('personalWeekend', lang);
      await sock.sendMessage(from, { text: reply });
      convs.set(from, { step: 'idle', lang });
      return;
    }

    if (selected.includes('Business') || selected.includes('عمل')) {
      if (!isWorkingHours || isWeekend) {
        await sock.sendMessage(from, { text: t('afterHours', lang) });
      }
      await sock.sendMessage(from, { text: t('businessQ', lang) });
      const sent = await sock.sendMessage(from, {
        poll: { name: t('businessQ', lang), values: BUSINESS_OPTIONS, selectableCount: 1 },
      });
      if (sent?.key.id) msgStore.set(sent.key.id, sent);
      convs.set(from, { step: 'awaiting_business_option', lang });
      return;
    }
  }

  if (conv.step === 'awaiting_business_option') {
    if (selected.includes('Schedule') || selected.includes('جدولة')) {
      await sock.sendMessage(from, { text: t('meetingPrompt', lang) });
      convs.set(from, { step: 'awaiting_meeting_time', lang });
      return;
    }

    if (selected.includes('email') || selected.includes('البريد')) {
      await sock.sendMessage(from, { text: t('emailReply', lang) });
      convs.set(from, { step: 'idle', lang });
      return;
    }

    if (selected.includes('message') || selected.includes('رسالة')) {
      await sock.sendMessage(from, { text: t('messagePrompt', lang) });
      convs.set(from, { step: 'awaiting_message', lang });
      return;
    }
  }
}

// ── Bot startup ───────────────────────────────────────────────────────────────

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
      if (shouldReconnect) { console.log('🔄 Reconnecting...'); startBot(); }
      else console.log('❌ Logged out. Delete .baileys_auth/ and restart.');
    }
    if (connection === 'open') console.log('✅ Bot is ready and listening for messages!\n');
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      if (msg.key.id) msgStore.set(msg.key.id, msg);
    }

    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe || !msg.key.remoteJid) continue;
      if (msg.key.remoteJid.endsWith('@g.us')) continue;

      const from = msg.key.remoteJid;
      if (!isAllowed(from)) continue;

      const text =
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        msg.message?.imageMessage?.caption ??
        '';

      if (!text.trim()) continue;

      try {
        await handleText(sock, from, text.trim());
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Error for ${from}:`, err);
      }
    }
  });

  sock.ev.on('messages.update', async (updates) => {
    for (const { key, update } of updates) {
      if (!update.pollUpdates || !key.id || !key.remoteJid) continue;
      if (key.remoteJid.endsWith('@g.us')) continue;

      const pollMsg = msgStore.get(key.id);
      if (!pollMsg) continue;

      try {
        const result = getAggregateVotesInPollMessage({
          message: pollMsg.message!,
          pollUpdates: update.pollUpdates,
        });
        const selected = result.find(r => r.voters.length > 0)?.name;
        if (selected) await handlePollVote(sock, key.remoteJid, selected);
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Poll error:`, err);
      }
    }
  });
}
