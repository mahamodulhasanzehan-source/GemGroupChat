import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../constants";

// Initialize Gemini Client
// Note: In a production React app, using process.env directly for API keys is risky if not proxied.
// However, per instructions, we are using the Vercel env var directly.
const apiKey = process.env.GEMINI_API_KEY_1;

const ai = new GoogleGenAI({ apiKey: apiKey || '' });

export const streamGeminiResponse = async (
  prompt: string, 
  history: { role: 'user' | 'model', text: string }[],
  onChunk: (text: string) => void
) => {
  try {
    // Construct history in the format Gemini expects or just send prompt if simple
    // For a simple chat implementation, we will use the chat helper
    
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
