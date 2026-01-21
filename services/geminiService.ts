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
  onChunk: (text: string) => void
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

  let attempts = 0;
  const maxAttempts = API_KEYS.length * 2; // Try every key, allow a second pass if needed
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
    try {
      const ai = getClient();
      
      // 1. Track Input Tokens (Optional/Best Effort)
      let inputTokens = 0;
      try {
        const countResult = await ai.models.countTokens({
            model: GEMINI_MODEL,
            contents: fullContents
        });
        inputTokens = countResult.totalTokens ?? 0;
      } catch (countError) {
          // Ignore count error, proceed to generation
      }

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
         if (chunk.text) {
           textAccumulated += chunk.text;
           onChunk(chunk.text);
         }
         if (chunk.usageMetadata) {
             usageMetadata = chunk.usageMetadata;
         }
      }

      // 2. Calculate Total Usage and Update DB
      let totalTokens = 0;
      if (usageMetadata) {
          totalTokens = usageMetadata.totalTokenCount;
      } else {
          // Fallback estimation
          const outputTokens = Math.ceil(textAccumulated.length / 4);
          totalTokens = inputTokens + outputTokens;
      }

      // Update usage AND the active key index so UI knows which key was used successfully
      if (totalTokens > 0) {
          updateTokenUsage(currentKeyIndex, totalTokens);
      }

      success = true;

    } catch (error: any) {
      console.error(`Gemini API Error (Attempt ${attempts + 1}/${maxAttempts} - KeyIdx ${currentKeyIndex}):`, error);
      
      const isRateLimit = error.message?.includes('429') || 
                          error.status === 429 ||
                          error.toString().includes('Resource has been exhausted');
      
      const isOverloaded = error.message?.includes('503') || 
                           error.status === 503;
      
      // Also rotate on 403 Forbidden (often means key is invalid or quota issue)
      const isForbidden = error.message?.includes('403') || error.status === 403;

      attempts++;

      // If rate limited, trigger GLOBAL COOL DOWN
      if (isRateLimit) {
           console.warn("429 Encountered. Triggering Project-Wide Cooldown.");
           // Set a 60 second cooldown for ALL clients listening to DB
           await setSystemCooldown(Date.now() + 60000);
           
           onChunk(`⚠️ **Rate Limit Hit**: A 429 error occurred. System entering 60s cooldown.`);
           success = false; // Stop loop
           return;
      }

      // If overloaded or forbidden, try next key
      if (isOverloaded || isForbidden) {
        rotateKey();
        updateTokenUsage(currentKeyIndex, 0); 
        await delay(1000); 
        continue;
      }

      // If we ran out of attempts
      if (attempts >= maxAttempts) {
         onChunk(`\n\n*Error: System exhausted. All ${API_KEYS.length} API keys are currently rate-limited or the system is overloaded. Please wait a moment.*`);
      } else {
         rotateKey();
         await delay(1000);
      }
    }
  }
};