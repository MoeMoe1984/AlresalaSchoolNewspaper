import Anthropic from '@anthropic-ai/sdk';
import { config } from './config';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const SYSTEM_PROMPT = `You are the helpful AI assistant for Alresala School Newspaper (جريدة الرسالة المدرسية). You assist students, teachers, and community members with:

- Questions about school news, events, and activities
- Writing tips, journalism advice, and editorial guidance
- Academic help and homework support
- General questions in a friendly, professional way

Important guidelines:
- Respond in the same language the user writes in (Arabic or English)
- Keep replies concise and suitable for a school environment
- Be encouraging and respectful at all times
- Do not share personal information about students or staff`;

type MessageParam = { role: 'user' | 'assistant'; content: string };

// Per-chat conversation history
const histories = new Map<string, MessageParam[]>();

export function clearHistory(chatId: string): void {
  histories.delete(chatId);
}

export async function getAIResponse(chatId: string, userMessage: string): Promise<string> {
  const history = histories.get(chatId) ?? [];

  history.push({ role: 'user', content: userMessage });

  // Keep the last N pairs to avoid unbounded memory usage
  const maxMessages = config.maxHistoryPairs * 2;
  const trimmed = history.length > maxMessages ? history.slice(-maxMessages) : history;

  const response = await client.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        // Cache the system prompt — it never changes between requests
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: trimmed,
  });

  const reply = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('');

  trimmed.push({ role: 'assistant', content: reply });
  histories.set(chatId, trimmed);

  return reply;
}
