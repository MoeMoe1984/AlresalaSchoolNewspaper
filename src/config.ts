import dotenv from 'dotenv';
dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is required. Run setup.sh to configure it.');
}

const allowedNumbers = process.env.ALLOWED_NUMBERS
  ? process.env.ALLOWED_NUMBERS.split(',').map(n => n.trim()).filter(Boolean)
  : [];

export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-1.5-flash' as const,
  maxHistoryPairs: 10,
  allowedNumbers,
};
