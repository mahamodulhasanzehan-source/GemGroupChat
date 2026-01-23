import { GoogleGenAI, Modality } from "@google/genai";
import { GEMINI_MODEL, GEMINI_TTS_MODEL } from "../constants";
import { updateTokenUsage } from "./firebase";
import { CanvasState } from "../types";

// --- Key Configuration ---

// We define a fixed map of 5 keys to ensure the UI always shows 5 slots.
// Keys 0-3 (Indices 0-3) are for Text/Code Generation.
// Key 4 (Index 4) is EXCLUSIVELY for Speech (TTS).
const KEY_MAP: Record<number, string | undefined> = {
    0: process.env.GEMINI_API_KEY_1 || process.env.API_KEY, // Fallback to generic key for slot 1
    1: process.env.GEMINI_API_KEY_2,
    2: process.env.GEMINI_API_KEY_3,
    3: process.env.GEMINI_API_KEY_4,
    4: process.env.GEMINI_API_KEY_5 // Exclusive TTS Key
};

export const TOTAL_KEYS = 5;
const TEXT_KEYS_INDICES = [0, 1, 2, 3];
const SPEECH_KEY_INDEX = 4;
const TEXT_KEYS_COUNT = TEXT_KEYS_INDICES.length;

// --- State ---

let currentTextKeyIndex = 0; 
let activeTextClient: GoogleGenAI | null = null;
let activeTextKey: string | null = null;

// Track Rate Limited Keys
const rateLimitedKeys = new Set<number>();

const keyStatusListeners: ((status: { currentIndex: number, rateLimited: number[] }) => void)[] = [];

const notifyListeners = () => {
    const status = {
        currentIndex: currentTextKeyIndex,
        rateLimited: Array.from(rateLimitedKeys)
    };
    keyStatusListeners.forEach(cb => cb(status));
};

export const subscribeToKeyStatus = (callback: (status: { currentIndex: number, rateLimited: number[] }) => void) => {
    keyStatusListeners.push(callback);
    callback({
        currentIndex: currentTextKeyIndex,
        rateLimited: Array.from(rateLimitedKeys)
    });
    return () => {
        const idx = keyStatusListeners.indexOf(callback);
        if (idx > -1) keyStatusListeners.splice(idx, 1);
    };
};

export const setManualKey = (index: number) => {
    if (index >= 0 && index < TOTAL_KEYS) {
        // If user selects the Speech key manually, we don't really switch the text client to it
        // unless we want to allow text generation on the speech key (not recommended by prompt, but useful for debugging).
        // For now, strictly update the UI index.
        currentTextKeyIndex = index;
        activeTextClient = null;
        activeTextKey = null;
        console.log(`[Gemini Service] Manually set to Key ${index + 1}`);
        notifyListeners();
    }
};

// --- Client Factory ---

const getTextClient = (): GoogleGenAI => {
    // If the current index points to a missing key, or the Speech key (if selected manually for text), 
    // try to find a valid text key.
    
    let keyToUse = KEY_MAP[currentTextKeyIndex];

    // If current key is missing, rotate to find one
    if (!keyToUse) {
        // Find first available text key
        const availableIndex = TEXT_KEYS_INDICES.find(i => !!KEY_MAP[i]);
        if (availableIndex !== undefined) {
            currentTextKeyIndex = availableIndex;
            keyToUse = KEY_MAP[availableIndex];
        } else {
            throw new Error("No Text API keys found. Please configure GEMINI_API_KEY_1.");
        }
    }

    if (!activeTextClient || activeTextKey !== keyToUse) {
        activeTextClient = new GoogleGenAI({ apiKey: keyToUse! });
        activeTextKey = keyToUse!;
    }
    return activeTextClient!;
};

const getSpeechClient = (): GoogleGenAI => {
    const speechKey = KEY_MAP[SPEECH_KEY_INDEX];
    if (!speechKey) {
        console.error("Speech Key (Key 5) is missing in environment variables.");
        throw new Error("Speech Key (GEMINI_API_KEY_5) is missing.");
    }
    return new GoogleGenAI({ apiKey: speechKey });
};

const rotateTextKey = () => {
    // Find next index in TEXT_KEYS_INDICES that wraps around
    const currentPos = TEXT_KEYS_INDICES.indexOf(currentTextKeyIndex);
    let nextPos = (currentPos + 1) % TEXT_KEYS_INDICES.length;
    
    // Simple rotation
    currentTextKeyIndex = TEXT_KEYS_INDICES[nextPos];
    
    // Reset client
    activeTextClient = null;
    activeTextKey = null;
    console.warn(`[Gemini Service] Rotating to Key ${currentTextKeyIndex + 1}`);
    notifyListeners();
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Audio Utils ---

export const base64ToWav = (base64Data: string, sampleRate = 24000) => {
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + len, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, len, true);
    const blob = new Blob([view, bytes], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
};

const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
};

// --- Generation ---

export const streamGeminiResponse = async (
  prompt: string, 
  history: { role: 'user' | 'model', text: string }[],
  canvasState: CanvasState | null,
  onChunk: (text: string) => void,
  signal?: AbortSignal
) => {
  let attempts = 0;
  const maxAttempts = TEXT_KEYS_COUNT; 
  let success = false;

  // Enhanced System Instruction for better Coding Performance
  const systemInstruction = `
  You are an expert Senior Full-Stack Web Developer and Solutions Architect.
  You are running inside a collaborative AI canvas environment.

  **CORE GUIDELINES:**
  1. **Efficient Editing**: If the user wants to *modify* existing code, DO NOT rewrite the entire file unless necessary.
  2. **Smart Patching**: Use the **SEARCH/REPLACE** block format to update specific sections.
  3. **Full Rewrite**: If asked to create a new app or if the changes are structural ( > 50% of code), output the full \`<html>\` block.

  **SEARCH/REPLACE FORMAT:**
  To edit specific lines, use this exact format:
  <<<<SEARCH
  [Exact lines of code to find from the current state. Must match whitespace exactly.]
  ====
  [New lines of code to replace the search block with.]
  >>>>

  **FULL CODE FORMAT:**
  To output a full file:
  \`\`\`html
  <!DOCTYPE html>
  <html>
  ...
  </html>
  \`\`\`

  **REQUIREMENTS:**
  - Write clean, modern, semantic, and accessible code.
  - Use Tailwind CSS via CDN for styling.
  - Ensure \`<body>\` content is complete (no placeholders like "// ... rest of code").

  **CURRENT CANVAS STATE (HTML):**
  \`\`\`html
  ${canvasState?.html || '<!-- Empty Canvas -->'}
  \`\`\`

  **USER REQUEST:**
  ${prompt}
  `;

  const historyContents = history.map(h => ({
    role: h.role,
    parts: [{ text: h.text }]
  }));
  
  const fullContents = [...historyContents, { role: 'user', parts: [{ text: systemInstruction }] }];

  while (attempts < maxAttempts && !success) {
    if (signal?.aborted) throw new Error("Aborted by user");

    try {
      const ai = getTextClient(); // Gets client for currentTextKeyIndex
      
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
        config: { 
            systemInstruction: systemInstruction,
            temperature: 0.7, // Balanced creativity and precision for code
            topK: 40,
            topP: 0.95,
        }
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
          updateTokenUsage(currentTextKeyIndex, totalTokens);
      }

      // Clear Rate Limit flag if successful
      if (rateLimitedKeys.has(currentTextKeyIndex)) {
          rateLimitedKeys.delete(currentTextKeyIndex);
          notifyListeners();
      }

    } catch (error: any) {
      if (error.message === "Aborted by user" || signal?.aborted) {
          throw error; 
      }

      const isRateLimit = error.message?.includes('429') || 
                          error.status === 429 ||
                          error.toString().includes('Resource has been exhausted');
      
      if (isRateLimit) {
          rateLimitedKeys.add(currentTextKeyIndex);
          console.warn(`[Gemini] Key ${currentTextKeyIndex + 1} hit rate limit.`);
      } else {
          console.warn(`[Gemini] Error on Key ${currentTextKeyIndex + 1}:`, error.message);
      }

      attempts++;
      
      if (attempts < maxAttempts) {
          rotateTextKey();
          await delay(1000); 
          continue; 
      }
      
      if (attempts >= maxAttempts) {
         onChunk(`\n\n*Error: Unable to generate response. All keys failed. Last error: ${error.message}*`);
         return; 
      }
    }
  }
};

export const generateSpeech = async (text: string, voiceName: string = 'Charon'): Promise<string | null> => {
    const cleanText = text
        .replace(/<<<<SEARCH[\s\S]*?>>>>/g, '') // Remove edit blocks from TTS
        .replace(/```[\s\S]*?```/g, '') 
        .replace(/`.*?`/g, '') 
        .replace(/<[^>]*>/g, '') 
        .trim();

    if (!cleanText || cleanText.length < 2) return null;

    try {
        const ai = getSpeechClient(); // Uses Key 5 (Index 4) explicitly
        
        console.log(`[Gemini TTS] Generating speech with model ${GEMINI_TTS_MODEL} using Key 5...`);

        const response = await ai.models.generateContent({
            model: GEMINI_TTS_MODEL,
            contents: [{ parts: [{ text: cleanText }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceName }
                    }
                }
            }
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
            // Track Usage for Key 5
            const usage = response.usageMetadata;
            if (usage) {
                updateTokenUsage(SPEECH_KEY_INDEX, usage.totalTokenCount);
            }
            // Clear rate limit if successful
            if (rateLimitedKeys.has(SPEECH_KEY_INDEX)) {
                rateLimitedKeys.delete(SPEECH_KEY_INDEX);
                notifyListeners();
            }
            return base64Audio;
        }

    } catch (e: any) {
        console.error("[Gemini TTS] Failed to generate speech:", e);
        rateLimitedKeys.add(SPEECH_KEY_INDEX);
        notifyListeners();
    }
    return null;
}