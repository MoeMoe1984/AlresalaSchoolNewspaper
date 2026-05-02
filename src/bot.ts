import qrcode from 'qrcode-terminal';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { createHmac } from 'crypto';
import pino from 'pino';
import { config } from './config';

const EMAIL = 'Mohamed.ali@altron.com';
const logger = pino({ level: 'silent' });

// Poll message store (keyed by message ID and by JID)
const pollStore    = new Map<string, WAMessage>();
const pollByJid    = new Map<string, WAMessage>();
// messageContextInfo.messageSecret — the actual HMAC key Baileys uses for polls
const pollKeyStore = new Map<string, Uint8Array>();

// ── Dubai time ───────────────────────────────────────────────────────────────

function getDubaiContext() {
  const dubai = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const d = dubai.getUTCDay();
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
const getConv = (jid: string): Conv =>
  convs.get(jid) ?? { step: 'idle', lang: 'en' };

// ── Text templates ────────────────────────────────────────────────────────────

const MSG = {
  greeting:       { en: 'Hello, This is the AI assistant of Dr. Mohamed Ali.\nPlease select one of the below options.', ar: 'مرحباً، أنا المساعد الذكي للدكتور محمد علي.\nيرجى اختيار أحد الخيارات أدناه.' },
  pleaseVote:     { en: 'Please use the poll above to select an option.', ar: 'يرجى الاختيار من الاستطلاع أعلاه.' },
  personalReply:  { en: 'You can connect to Dr. Mohamed Ali directly and leave your message.', ar: 'يمكنك التواصل مع الدكتور محمد علي مباشرةً وترك رسالتك.' },
  businessQ:      { en: 'How can we help you?', ar: 'كيف يمكننا مساعدتك؟' },
  afterHours:     { en: '⚠️ Dr. Mohamed Ali will get back to you on Monday after 8 AM.', ar: '⚠️ سيتواصل معك الدكتور محمد علي يوم الاثنين بعد الساعة 8 صباحاً.' },
  meetingPrompt:  { en: 'Please reply with your preferred date and time and we will confirm it.', ar: 'يرجى إرسال التاريخ والوقت المناسب لك وسنؤكد الموعد.' },
  meetingConfirm: { en: '✅ Your meeting request has been noted. Dr. Mohamed Ali will confirm shortly.', ar: '✅ تم تسجيل طلب الاجتماع. سيتواصل معك الدكتور محمد علي للتأكيد قريباً.' },
  emailReply:     { en: `📧 Official email of Dr. Mohamed Ali:\n${EMAIL}`, ar: `📧 البريد الإلكتروني الرسمي للدكتور محمد علي:\n${EMAIL}` },
  messagePrompt:  { en: 'Please type your message and I will make sure Dr. Mohamed Ali receives it.', ar: 'يرجى كتابة رسالتك وسأتأكد من إيصالها للدكتور محمد علي.' },
  messageConfirm: { en: '✅ Your message has been noted and will be forwarded to Dr. Mohamed Ali.', ar: '✅ تم استلام رسالتك وسيتم إرسالها للدكتور محمد علي.' },
  cleared:        { en: 'Conversation reset. Send a message to start again.', ar: 'تمت إعادة المحادثة. أرسل رسالة للبدء من جديد.' },
} as const;

const t = (key: keyof typeof MSG, lang: Lang) => MSG[key][lang];

// ── Poll option labels ────────────────────────────────────────────────────────

const PURPOSE_OPTIONS  = ['👤 Personal / شخصي', '💼 Business / عمل'];
const BUSINESS_OPTIONS = [
  '📅 Schedule a meeting / جدولة اجتماع',
  '📧 Get official email / البريد الإلكتروني',
  '✉️ Leave a message / ترك رسالة',
];

// ── Poll vote decoder ─────────────────────────────────────────────────────────

// WhatsApp encodes each selected option as HMAC-SHA256(messageSecret, optionName).
function findVotedOption(
  selectedHashes: Uint8Array[],
  options: string[],
  secret: Uint8Array,
): string | undefined {
  for (const option of options) {
    const expected = createHmac('sha256', Buffer.from(secret))
      .update(Buffer.from(option))
      .digest();
    if (selectedHashes.some(
      h => h.length === expected.length && h.every((b, i) => b === expected[i]),
    )) return option;
  }
  return undefined;
}

// ── Poll storage helper ───────────────────────────────────────────────────────

function storePoll(id: string, jid: string, msg: WAMessage) {
  pollStore.set(id, msg);
  pollByJid.set(jid, msg);
  const secret = (msg.message as any)?.messageContextInfo?.messageSecret as Uint8Array | undefined;
  if (secret?.length) pollKeyStore.set(id, secret);
  console.log('[Poll stored] id:', id, '| secret:', secret?.length === 32 ? 'OK' : 'MISSING');
}

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
      await sock.sendMessage(from, { text: t('greeting', lang) });
      const p1 = await sock.sendMessage(from, {
        poll: { name: 'Select an option / اختر خياراً', values: PURPOSE_OPTIONS, selectableCount: 1 },
      });
      if (p1?.key.id) storePoll(p1.key.id, from, p1);
      break;
    }

    case 'awaiting_purpose':
      if (text === '1') { await handlePollVote(sock, from, 'Personal'); return; }
      if (text === '2') { await handlePollVote(sock, from, 'Business'); return; }
      await sock.sendMessage(from, { text: t('pleaseVote', conv.lang) });
      break;

    case 'awaiting_business_option':
      if (text === '1') { await handlePollVote(sock, from, 'Schedule'); return; }
      if (text === '2') { await handlePollVote(sock, from, 'email'); return; }
      if (text === '3') { await handlePollVote(sock, from, 'message'); return; }
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
      await sock.sendMessage(from, { text: t('personalReply', lang) });
      convs.set(from, { step: 'idle', lang });
      return;
    }
    if (selected.includes('Business') || selected.includes('عمل')) {
      if (!isWorkingHours || isWeekend) {
        await sock.sendMessage(from, { text: t('afterHours', lang) });
      }
      await sock.sendMessage(from, { text: t('businessQ', lang) });
      const p2 = await sock.sendMessage(from, {
        poll: { name: t('businessQ', lang), values: BUSINESS_OPTIONS, selectableCount: 1 },
      });
      if (p2?.key.id) storePoll(p2.key.id, from, p2);
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
    logger,
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
    // Capture bot's own sent poll echoes to update pollStore with complete message
    if (type === 'append' || type === 'notify') {
      for (const msg of messages) {
        if (!msg.key.fromMe || !msg.key.id || !msg.message || !msg.key.remoteJid) continue;
        const m = msg.message as any;
        if (m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3) {
          storePoll(msg.key.id, msg.key.remoteJid, msg);
        }
      }
    }

    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.key.remoteJid) continue;
      if (msg.key.remoteJid.endsWith('@g.us')) continue;

      const from = msg.key.remoteJid;
      if (!isAllowed(from)) continue;

      // ── Poll vote ──────────────────────────────────────────────────────────
      const pollUpd = msg.message?.pollUpdateMessage;
      if (pollUpd) {
        const origId = pollUpd.pollCreationMessageKey?.id;
        const selectedHashes: Uint8Array[] = (pollUpd.vote as any)?.selectedOptions ?? [];

        console.log('[vote] from:', from, 'origId:', origId, 'selected:', selectedHashes.length);

        if (selectedHashes.length === 0) {
          // User deselected — ignore
          continue;
        }

        // Resolve the secret: by poll ID first, then by JID fallback
        const secret: Uint8Array | undefined =
          (origId ? pollKeyStore.get(origId) : undefined) ??
          (origId ? ((pollStore.get(origId)?.message as any)?.messageContextInfo?.messageSecret) : undefined) ??
          ((pollByJid.get(from)?.message as any)?.messageContextInfo?.messageSecret);

        if (!secret?.length) {
          console.log('[vote] no messageSecret found for poll');
          continue;
        }

        const conv = getConv(from);
        const options = conv.step === 'awaiting_purpose' ? PURPOSE_OPTIONS : BUSINESS_OPTIONS;
        const selected = findVotedOption(selectedHashes, options, secret);

        if (selected) {
          console.log(`[vote] ${from} → "${selected}"`);
          await handlePollVote(sock, from, selected);
        } else {
          console.log('[vote] HMAC matched no option — wrong step or wrong key');
        }
        continue;
      }

      // ── Text message ───────────────────────────────────────────────────────
      if (msg.key.fromMe) continue;

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
}
