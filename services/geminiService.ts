import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../constants";

// Initialize Gemini Client
const apiKey = process.env.GEMINI_API_KEY_1;

// We initialize even if empty to prevent import crashes, but check at usage time
const ai = new GoogleGenAI({ apiKey: apiKey || 'dummy-key-for-init' });

export const streamGeminiResponse = async (
  prompt: string, 
  history: { role: 'user' | 'model', text: string }[],
  onChunk: (text: string) => void
) => {
  if (!apiKey) {
      onChunk(`⚠️ **Configuration Error**: \`GEMINI_API_KEY_1\` is missing from your Vercel Environment Variables.
      
To fix this:
1. Go to your Vercel Project Settings.
2. Navigate to **Environment Variables**.
3. Add a new variable named \`GEMINI_API_KEY_1\` with your Google Gemini API key.`);
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