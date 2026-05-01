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

type Message = { role: 'user' | 'assistant'; content: string };

const histories = new Map<string, Message[]>();

export function clearHistory(chatId: string): void {
  histories.delete(chatId);
}

export async function getAIResponse(chatId: string, userMessage: string): Promise<string> {
  const history = histories.get(chatId) ?? [];

  const messages: Message[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.groqApiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
      ],
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq ${response.status}: ${err}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  const reply = data.choices[0].message.content;

  messages.push({ role: 'assistant', content: reply });

  const maxMessages = config.maxHistoryPairs * 2;
  histories.set(chatId, messages.length > maxMessages ? messages.slice(-maxMessages) : messages);

  return reply;
}
