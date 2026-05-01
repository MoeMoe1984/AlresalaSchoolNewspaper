import { config } from './config';

const SYSTEM_PROMPT = `You are a helpful personal AI assistant. You help with:

- Answering questions and providing information
- Writing, editing, and brainstorming ideas
- Academic help and research
- General tasks, advice, and conversation

Important guidelines:
- Respond in the same language the user writes in (Arabic or English)
- Keep replies concise and helpful
- Be friendly and respectful at all times`;

type Part = { text: string };
type Content = { role: 'user' | 'model'; parts: Part[] };

const histories = new Map<string, Content[]>();

export function clearHistory(chatId: string): void {
  histories.delete(chatId);
}

export async function getAIResponse(chatId: string, userMessage: string): Promise<string> {
  const history = histories.get(chatId) ?? [];

  const contents: Content[] = [
    ...history,
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  const url = `https://generativelanguage.googleapis.com/v1/models/${config.model}:generateContent?key=${config.geminiApiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini ${response.status}: ${err}`);
  }

  const data = await response.json() as { candidates: Array<{ content: Content }> };
  const reply = data.candidates[0].content.parts.map(p => p.text).join('');

  contents.push({ role: 'model', parts: [{ text: reply }] });

  const maxMessages = config.maxHistoryPairs * 2;
  histories.set(chatId, contents.length > maxMessages ? contents.slice(-maxMessages) : contents);

  return reply;
}
