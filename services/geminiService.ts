import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../constants";
import { updateTokenUsage, getSystemConfig, setSystemCooldown } from "./firebase";
import { CanvasState } from "../types";

// 1. Define Keys Array
const API_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
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
  // Force client recreation next time getClient is called
  aiClient = null; 
  activeKey = null;
};

// Delay helper for retries
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const streamGeminiResponse = async (
  prompt: string, 
  history: { role: 'user' | 'model', text: string }[],
  canvasState: CanvasState | null,
  onChunk: (text: string) => void,
  signal?: AbortSignal
) => {
  if (API_KEYS.length === 0) {
      onChunk(`⚠️ **Configuration Error**: No \`GEMINI_API_KEY_x\` found in Environment Variables.`);
      return;
  }

  // GLOBAL CIRCUIT BREAKER CHECK
  const config = await getSystemConfig();
  if (config.globalCooldownUntil > Date.now()) {
      const waitSeconds = Math.ceil((config.globalCooldownUntil - Date.now()) / 1000);
      onChunk(`⚠️ **System Cooldown**: All API keys are currently rate-limited. Please wait ${waitSeconds} seconds.`);
      return;
  }

  // Max attempts = number of keys. We try each key exactly once per request.
  // If all keys fail, we stop. We do not loop endlessly.
  let attempts = 0;
  const maxAttempts = API_KEYS.length; 
  let success = false;

  // SYSTEM INSTRUCTION FOR CODING CANVAS
  const systemInstruction = `
  You are an expert full-stack web developer and coding assistant.
  
  CONTEXT:
  You have access to a "Canvas" environment that renders a SINGLE HTML file.
  
  CURRENT CANVAS STATE (HTML):
  \`\`\`html
  ${canvasState?.html || '<!-- Empty -->'}
  \`\`\`

  INSTRUCTIONS:
  1. Write the COMPLETE functional application in a SINGLE \`html\` code block.
  2. You MUST include your CSS inside \`<style>\` tags within the \`<head>\`.
  3. You MUST include your JavaScript inside \`<script>\` tags within the \`<body>\`.
  4. DO NOT output separate \`css\` or \`javascript\` blocks. Everything must be in one \`html\` file.
  5. If updating existing code, you can output just the parts that change if you are clever, but usually outputting the full updated HTML block is safer to ensure consistency in this single-file mode.
  6. Ensure the code is self-contained (no external local file references, use CDNs if needed).
  `;

  const historyContents = history.map(h => ({
    role: h.role,
    parts: [{ text: h.text }]
  }));
  const currentContent = { role: 'user', parts: [{ text: systemInstruction + "\n\nUser Prompt: " + prompt }] };
  const fullContents = [...historyContents, currentContent];

  while (attempts < maxAttempts && !success) {
    // 1. Check Abort Signal immediately
    if (signal?.aborted) {
        throw new Error("Aborted by user");
    }

    try {
      const ai = getClient();
      
      // Optional: Input Token Check (Silent fail)
      let inputTokens = 0;
      try {
        const countResult = await ai.models.countTokens({
            model: GEMINI_MODEL,
            contents: fullContents
        });
        inputTokens = countResult.totalTokens ?? 0;
      } catch (countError) {}

      const chat = ai.chats.create({
        model: GEMINI_MODEL,
        history: history.map(h => ({
          role: h.role,
          parts: [{ text: h.text }]
        })),
        config: {
            systemInstruction: systemInstruction
        }
      });

      const result = await chat.sendMessageStream({ message: prompt });
      
      let textAccumulated = '';
      let usageMetadata: any = null;

      for await (const chunk of result) {
         if (signal?.aborted) {
             throw new Error("Aborted by user");
         }
         if (chunk.text) {
           textAccumulated += chunk.text;
           onChunk(chunk.text);
         }
         if (chunk.usageMetadata) {
             usageMetadata = chunk.usageMetadata;
         }
      }

      // Success! Calculate Usage
      let totalTokens = 0;
      if (usageMetadata) {
          totalTokens = usageMetadata.totalTokenCount;
      } else {
          const outputTokens = Math.ceil(textAccumulated.length / 4);
          totalTokens = inputTokens + outputTokens;
      }

      if (totalTokens > 0) {
          // Only update usage on SUCCESS.
          updateTokenUsage(currentKeyIndex, totalTokens);
      }

      success = true; // Break the loop

    } catch (error: any) {
      if (error.message === "Aborted by user" || signal?.aborted) {
          throw error; // Re-throw aborts to exit immediately
      }

      attempts++;
      console.error(`Gemini API Error (KeyIdx ${currentKeyIndex}):`, error.message);
      
      const isRateLimit = error.message?.includes('429') || 
                          error.status === 429 ||
                          error.toString().includes('Resource has been exhausted');
      
      const isOverloaded = error.message?.includes('503') || error.status === 503;
      const isForbidden = error.message?.includes('403') || error.status === 403;
      // Key not found or invalid
      const isKeyError = error.message?.includes('API key not valid') || error.message?.includes('key not found');

      if (isRateLimit) {
           console.warn("429 Encountered. Triggering Project-Wide Cooldown.");
           await setSystemCooldown(Date.now() + 60000);
           onChunk(`⚠️ **Rate Limit Hit**: A 429 error occurred. System entering 60s cooldown.`);
           return; // Stop trying other keys, the project is rate limited.
      }

      // If it's a specific error that warrants trying another key
      if (isOverloaded || isForbidden || isKeyError) {
        rotateKey();
        // Do NOT updateTokenUsage(0) here, it messes up the stats.
        
        // Add a delay to prevent rapid strobing
        await delay(1500); 
        continue;
      }

      // If it's a completely unknown error (e.g. 400 Bad Request on prompt), stop.
      onChunk(`\n\n*Error: ${error.message}*`);
      return;
    }
  }

  if (!success && !signal?.aborted) {
      onChunk(`\n\n*System Exhausted: Tried all ${maxAttempts} available API keys without success.*`);
  }
};