import { GoogleGenAI } from "@google/genai";
import { GEMINI_MODEL } from "../constants";
import { updateTokenUsage } from "./firebase";
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
};

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

  let attempts = 0;
  const maxAttempts = API_KEYS.length; // Try every key once
  let success = false;

  // SYSTEM INSTRUCTION FOR CODING CANVAS
  const systemInstruction = `
  You are an expert full-stack web developer and coding assistant.
  
  CONTEXT:
  You have access to a "Canvas" environment where you can write and update HTML, CSS, and JavaScript files.
  The user can see the code editor, a live preview, and a terminal.
  
  CURRENT CANVAS STATE:
  HTML Length: ${canvasState?.html.length || 0}
  CSS Length: ${canvasState?.css.length || 0}
  JS Length: ${canvasState?.js.length || 0}
  
  HTML Content:
  \`\`\`html
  ${canvasState?.html || '<!-- Empty -->'}
  \`\`\`
  
  CSS Content:
  \`\`\`css
  ${canvasState?.css || '/* Empty */'}
  \`\`\`

  JS Content:
  \`\`\`javascript
  ${canvasState?.js || '// Empty'}
  \`\`\`

  INSTRUCTIONS:
  1. If the user asks for code changes, DO NOT output the entire file unless necessary.
  2. You can "internally break up" the code. Only output the specific code blocks (HTML, CSS, or JS) that need to be updated.
  3. If you output a code block with \`html\`, \`css\`, or \`javascript\` language tags, the system will automatically update the Canvas.
  4. Ensure your code is valid and syntax-correct.
  5. Use the console/terminal concept by mentioning actions if needed, but primarily write code.
  `;

  // Prepare full contents for counting tokens
  const historyContents = history.map(h => ({
    role: h.role,
    parts: [{ text: h.text }]
  }));
  const currentContent = { role: 'user', parts: [{ text: systemInstruction + "\n\nUser Prompt: " + prompt }] };
  const fullContents = [...historyContents, currentContent];

  while (attempts < maxAttempts && !success) {
    try {
      const ai = getClient();
      
      // 1. Track Input Tokens
      let inputTokens = 0;
      try {
        const countResult = await ai.models.countTokens({
            model: GEMINI_MODEL,
            contents: fullContents
        });
        inputTokens = countResult.totalTokens ?? 0;
      } catch (countError) {
          console.warn(`[Gemini Service] countTokens failed on key ${currentKeyIndex}`, countError);
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
          const outputTokens = Math.ceil(textAccumulated.length / 4);
          totalTokens = inputTokens + outputTokens;
      }

      // Update usage AND the active key index so UI knows which key was used
      if (totalTokens > 0) {
          updateTokenUsage(currentKeyIndex, totalTokens);
      }

      success = true;

    } catch (error: any) {
      console.error(`Gemini API Error (Attempt ${attempts + 1}/${maxAttempts}):`, error);
      
      const isRateLimit = error.message?.includes('429') || 
                          error.message?.includes('400') ||
                          error.status === 429 ||
                          error.toString().includes('Resource has been exhausted');

      if (isRateLimit) {
        attempts++;
        if (attempts < maxAttempts) {
          rotateKey();
          continue;
        }
      }

      if (attempts >= maxAttempts) {
         onChunk(`\n\n*Error: System overloaded. All API keys are currently rate-limited. Please try again in a minute.*`);
      } else {
         onChunk(`\n\n*Error: ${error.message || 'Unknown Gemini API error'}*`);
         success = true;
      }
    }
  }
};