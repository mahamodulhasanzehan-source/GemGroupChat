import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../constants";
import { updateTokenUsage, getSystemConfig } from "./firebase";
import { CanvasState } from "../types";

// 1. Define Keys Array
const API_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
  process.env.API_KEY // Fallback
].filter(Boolean) as string[];

export const TOTAL_KEYS = API_KEYS.length;

// 2. State
let currentKeyIndex = 0;
let aiClient: GoogleGenAI | null = null;
let activeKey: string | null = null;

// Track Rate Limited Keys (Yellow status)
const rateLimitedKeys = new Set<number>();

// Subscription for UI
const keyStatusListeners: ((status: { currentIndex: number, rateLimited: number[] }) => void)[] = [];

const notifyListeners = () => {
    const status = {
        currentIndex: currentKeyIndex,
        rateLimited: Array.from(rateLimitedKeys)
    };
    keyStatusListeners.forEach(cb => cb(status));
};

export const subscribeToKeyStatus = (callback: (status: { currentIndex: number, rateLimited: number[] }) => void) => {
    keyStatusListeners.push(callback);
    // Send initial state
    callback({
        currentIndex: currentKeyIndex,
        rateLimited: Array.from(rateLimitedKeys)
    });
    return () => {
        const idx = keyStatusListeners.indexOf(callback);
        if (idx > -1) keyStatusListeners.splice(idx, 1);
    };
};

export const setManualKey = (index: number) => {
    if (index >= 0 && index < API_KEYS.length) {
        currentKeyIndex = index;
        aiClient = null; // Force client recreate
        activeKey = null;
        console.log(`[Gemini Service] Manually set to Key ${index + 1}`);
        notifyListeners();
    }
};

// Helper to get or create client with current key
const getClient = (): GoogleGenAI => {
  const keyToUse = API_KEYS[currentKeyIndex];
  
  if (!keyToUse) {
    throw new Error("No API keys found in configuration.");
  }

  if (!aiClient || activeKey !== keyToUse) {
    // console.log(`[Gemini Service] Initializing Client with Key Index: ${currentKeyIndex}`);
    aiClient = new GoogleGenAI({ apiKey: keyToUse });
    activeKey = keyToUse;
  }
  return aiClient;
};

const switchToNextKey = () => {
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    aiClient = null;
    activeKey = null;
    console.warn(`[Gemini Service] Switching to Key ${currentKeyIndex + 1}`);
    notifyListeners();
};

// Delay helper
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

  // NOTE: We removed the global system cooldown check here per request.
  // We rely on rotating keys if one fails.

  let attempts = 0;
  const maxAttempts = API_KEYS.length; // Try each key once
  let success = false;

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
  // Note: Gemini 1.5+ generally prefers system instruction in config, but chat prompts work too.
  // We'll keep prompt construction as is.
  const currentContent = { role: 'user', parts: [{ text: systemInstruction + "\n\nUser Prompt: " + prompt }] };
  const fullContents = [...historyContents, currentContent];

  // RETRY LOOP
  while (attempts < maxAttempts && !success) {
    if (signal?.aborted) throw new Error("Aborted by user");

    try {
      const ai = getClient();
      
      // Attempt to count tokens (optional, doesn't break flow)
      let inputTokens = 0;
      try {
        const countResult = await ai.models.countTokens({
            model: GEMINI_MODEL,
            contents: fullContents
        });
        inputTokens = countResult.totalTokens ?? 0;
      } catch (e) {}

      const chat = ai.chats.create({
        model: GEMINI_MODEL,
        history: history.map(h => ({
          role: h.role,
          parts: [{ text: h.text }]
        })),
        config: { systemInstruction }
      });

      const result = await chat.sendMessageStream({ message: prompt });
      
      let textAccumulated = '';
      let usageMetadata: any = null;

      for await (const chunk of result) {
         if (signal?.aborted) throw new Error("Aborted by user");
         
         if (chunk.text) {
           textAccumulated += chunk.text;
           onChunk(chunk.text);
         }
         if (chunk.usageMetadata) {
             usageMetadata = chunk.usageMetadata;
         }
      }

      // If we got here, request was successful
      success = true;

      // Update Usage
      let totalTokens = 0;
      if (usageMetadata) {
          totalTokens = usageMetadata.totalTokenCount;
      } else {
          const outputTokens = Math.ceil(textAccumulated.length / 4);
          totalTokens = inputTokens + outputTokens;
      }
      if (totalTokens > 0) {
          updateTokenUsage(currentKeyIndex, totalTokens);
      }

      // Remove from rate limited set if it succeeds (optional, but logical)
      if (rateLimitedKeys.has(currentKeyIndex)) {
          rateLimitedKeys.delete(currentKeyIndex);
          notifyListeners();
      }

    } catch (error: any) {
      if (error.message === "Aborted by user" || signal?.aborted) {
          throw error; 
      }

      // Log error
      console.warn(`[Gemini] Error on Key ${currentKeyIndex + 1}:`, error.message);

      const isRateLimit = error.message?.includes('429') || 
                          error.status === 429 ||
                          error.toString().includes('Resource has been exhausted');
      
      const isOverloaded = error.message?.includes('503') || error.status === 503;
      const isForbidden = error.message?.includes('403') || error.status === 403;
      const isKeyError = error.message?.includes('API key') || error.message?.includes('key not found');

      if (isRateLimit || isOverloaded || isForbidden || isKeyError) {
          // If Rate Limited, mark it Yellow
          if (isRateLimit) {
              rateLimitedKeys.add(currentKeyIndex);
          }

          attempts++;
          
          // If we haven't tried all keys yet, switch to next and retry loop
          if (attempts < maxAttempts) {
              switchToNextKey();
              await delay(1000); // Small delay before retry
              continue; // Retry loop
          }
      }
      
      // If error is unknown (400 Bad Request) or we exhausted all keys
      if (attempts >= maxAttempts) {
         if (isRateLimit) {
             onChunk(`\n\n*Error: All ${maxAttempts} keys are rate-limited. Please wait a moment.*`);
         } else {
             onChunk(`\n\n*Error: ${error.message}*`);
         }
         return; // Exit
      }
      
      // If unknown error but we have attempts left, we might still want to rotate?
      // For safety, let's rotate on unknown network errors too.
      attempts++;
      switchToNextKey();
      await delay(1000);
    }
  }
};