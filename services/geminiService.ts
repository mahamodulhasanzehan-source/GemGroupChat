import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../constants";

// 1. Define Keys Array
const API_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.API_KEY // Fallback to generic key
].filter(Boolean) as string[];

// 2. State for rotation
let currentKeyIndex = 0;
let aiClient: GoogleGenAI | null = null;
let activeKey: string | null = null;

// Helper to get or create client with current key
const getClient = (): GoogleGenAI => {
  const keyToUse = API_KEYS[currentKeyIndex];
  
  if (!keyToUse) {
    throw new Error("No API keys found in configuration.");
  }

  // If we haven't initialized, or if the key index changed (rotation happened), re-init
  if (!aiClient || activeKey !== keyToUse) {
    console.log(`[Gemini Service] Switching to API Key Index: ${currentKeyIndex}`);
    aiClient = new GoogleGenAI({ apiKey: keyToUse });
    activeKey = keyToUse;
  }
  return aiClient;
};

// Helper to rotate key index
const rotateKey = () => {
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  console.warn(`[Gemini Service] Rotating to next key. New Index: ${currentKeyIndex}`);
};

export const streamGeminiResponse = async (
  prompt: string, 
  history: { role: 'user' | 'model', text: string }[],
  onChunk: (text: string) => void
) => {
  if (API_KEYS.length === 0) {
      onChunk(`⚠️ **Configuration Error**: No \`GEMINI_API_KEY_x\` found in Environment Variables.`);
      return;
  }

  let attempts = 0;
  const maxAttempts = API_KEYS.length; // Try every key once
  let success = false;

  while (attempts < maxAttempts && !success) {
    try {
      const ai = getClient();
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
      success = true; // Loop finishes if successful

    } catch (error: any) {
      console.error(`Gemini API Error (Attempt ${attempts + 1}/${maxAttempts}):`, error);
      
      // Check for Rate Limit (429) or Service Unavailable (503) or Resource Exhausted
      const isRateLimit = error.message?.includes('429') || 
                          error.message?.includes('400') || // Sometimes quotas show as 400 in SDK
                          error.status === 429 ||
                          error.toString().includes('Resource has been exhausted');

      if (isRateLimit) {
        attempts++;
        if (attempts < maxAttempts) {
          rotateKey(); // Switch key for next loop iteration
          continue; // Retry loop
        }
      }

      // If not a retryable error, or out of attempts
      if (attempts >= maxAttempts) {
         onChunk(`\n\n*Error: System overloaded. All API keys are currently rate-limited. Please try again in a minute.*`);
      } else {
         // Generic error (not rate limit)
         onChunk(`\n\n*Error: ${error.message || 'Unknown Gemini API error'}*`);
         success = true; // Exit loop to avoid infinite retries on bad requests
      }
    }
  }
};