import dotenv from 'dotenv';
dotenv.config();

if (!process.env.GROQ_API_KEY) {
  throw new Error('GROQ_API_KEY is required. Run setup.sh to configure it.');
}

const allowedNumbers = process.env.ALLOWED_NUMBERS
  ? process.env.ALLOWED_NUMBERS.split(',').map(n => n.trim()).filter(Boolean)
  : [];

export const config = {
  groqApiKey: process.env.GROQ_API_KEY,
  model: 'llama-3.1-8b-instant' as const,
  maxHistoryPairs: 10,
  allowedNumbers,
};
