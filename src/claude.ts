import { GoogleGenerativeAI, Content } from '@google/generative-ai';
import { config } from './config';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

const SYSTEM_PROMPT = `You are a helpful personal AI assistant. You help with:

- Answering questions and providing information
- Writing, editing, and brainstorming ideas
- Academic help and research
- General tasks, advice, and conversation

Important guidelines:
- Respond in the same language the user writes in (Arabic or English)
- Keep replies concise and helpful
- Be friendly and respectful at all times`;

const histories = new Map<string, Content[]>();

export function clearHistory(chatId: string): void {
  histories.delete(chatId);
}

export async function getAIResponse(chatId: string, userMessage: string): Promise<string> {
  const history = histories.get(chatId) ?? [];

  const model = genAI.getGenerativeModel({
    model: config.model,
    systemInstruction: SYSTEM_PROMPT,
  });

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(userMessage);
  const reply = result.response.text();

  history.push(
    { role: 'user', parts: [{ text: userMessage }] },
    { role: 'model', parts: [{ text: reply }] },
  );

  const maxMessages = config.maxHistoryPairs * 2;
  if (history.length > maxMessages) {
    history.splice(0, history.length - maxMessages);
  }

  histories.set(chatId, history);
  return reply;
}
