import dotenv from 'dotenv';
dotenv.config();

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is required. Copy .env.example to .env and fill it in.');
}

const allowedNumbers = process.env.ALLOWED_NUMBERS
  ? process.env.ALLOWED_NUMBERS.split(',').map(n => n.trim()).filter(Boolean)
  : [];

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-opus-4-7' as const,
  maxTokens: 1024,
  // How many user+assistant pairs to keep per chat before trimming
  maxHistoryPairs: 10,
  // Restrict replies to specific numbers (empty = reply to all)
  allowedNumbers,
};
