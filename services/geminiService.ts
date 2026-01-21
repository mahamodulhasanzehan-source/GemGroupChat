import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../constants";

// Lazy initialization variable
let ai: GoogleGenAI | null = null;

export const streamGeminiResponse = async (
  prompt: string, 
  history: { role: 'user' | 'model', text: string }[],
  onChunk: (text: string) => void
) => {
  // Check for key at runtime, not load time
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY_1;

  if (!apiKey) {
      onChunk(`⚠️ **Configuration Error**: \`GEMINI_API_KEY_1\` is missing from your Environment Variables. Please add it to Vercel settings.`);
      return;
  }

  try {
    // Initialize only when needed
    if (!ai) {
        ai = new GoogleGenAI({ apiKey: apiKey });
    }

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