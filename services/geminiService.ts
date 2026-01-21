import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../constants";

// Use API_KEY from environment variables as per guidelines.
// Fallback to GEMINI_API_KEY_1 for backward compatibility with existing setup.
const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY_1;

// Initialize GoogleGenAI
const ai = new GoogleGenAI({ apiKey: apiKey || '' });

export const streamGeminiResponse = async (
  prompt: string, 
  history: { role: 'user' | 'model', text: string }[],
  onChunk: (text: string) => void
) => {
  if (!apiKey) {
      onChunk(`⚠️ **Configuration Error**: \`API_KEY\` is missing from your Environment Variables.`);
      return;
  }

  try {
    const chat = ai.chats.create({
      model: GEMINI_MODEL,
      history: history.map(h => ({
        role: h.role,
        parts: [{ text: h.text }]
      }))
    });

    const result = await chat.sendMessageStream({ message: prompt });
    
    for await (const chunk of result) {
       if (chunk.text) {
         onChunk(chunk.text);
       }
    }
  } catch (error) {
    console.error("Gemini API Error:", error);
    onChunk("\n\n*Error: Unable to connect to Gemini. Please check your API key configuration.*");
  }
};