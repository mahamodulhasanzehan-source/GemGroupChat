import { GoogleGenAI, Modality } from "@google/genai";
import { GEMINI_MODEL, GEMINI_TTS_MODEL } from "../constants";
import { updateTokenUsage } from "./firebase";
import { CanvasState } from "../types";

// 1. Define Keys Array
// Keys 0-3 are for Text/Code. Key 4 is exclusively for TTS.
const API_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
  process.env.API_KEY // Fallback
].filter(Boolean) as string[];

export const TOTAL_KEYS = API_KEYS.length;
const TEXT_KEYS_COUNT = 4; // First 4 keys for text
const SPEECH_KEY_INDEX = 4; // 5th key (index 4) for TTS

// 2. State
let currentKeyIndex = 0; // Only cycles 0-3
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
    // Allow selecting Key 5 manually for visualization, but logic mostly respects TEXT/SPEECH split
    if (index >= 0 && index < API_KEYS.length) {
        currentKeyIndex = index;
        aiClient = null; // Force client recreate
        activeKey = null;
        console.log(`[Gemini Service] Manually set to Key ${index + 1}`);
        notifyListeners();
    }
};

// Helper to get or create client with current key (For Text)
const getClient = (): GoogleGenAI => {
  // Ensure we are using one of the text keys (unless manually overridden to 4)
  const keyIndexToUse = currentKeyIndex < TEXT_KEYS_COUNT ? currentKeyIndex : currentKeyIndex;
  const keyToUse = API_KEYS[keyIndexToUse];
  
  if (!keyToUse) {
    throw new Error("No API keys found in configuration.");
  }

  if (!aiClient || activeKey !== keyToUse) {
    aiClient = new GoogleGenAI({ apiKey: keyToUse });
    activeKey = keyToUse;
  }
  return aiClient;
};

// Helper for Speech Client (Always uses Key 5)
const getSpeechClient = (): GoogleGenAI => {
    const speechKey = API_KEYS[SPEECH_KEY_INDEX];
    if (!speechKey) {
        throw new Error("Speech Key (Key 5) is missing.");
    }
    return new GoogleGenAI({ apiKey: speechKey });
}

const switchToNextKey = () => {
    // Only cycle through the first 4 keys (0, 1, 2, 3)
    currentKeyIndex = (currentKeyIndex + 1) % TEXT_KEYS_COUNT;
    aiClient = null;
    activeKey = null;
    console.warn(`[Gemini Service] Switching to Key ${currentKeyIndex + 1}`);
    notifyListeners();
};

// Delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Audio Utilities ---

// Convert Base64 PCM to WAV Blob URL
const base64ToWav = (base64Data: string, sampleRate = 24000) => {
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Gemini returns Int16 PCM usually. Let's assume 1 channel, 16-bit.
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    
    // RIFF chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + len, true); // File size
    writeString(view, 8, 'WAVE');
    
    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, 1, true); // NumChannels (1 for Mono)
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
    view.setUint16(32, 2, true); // BlockAlign (NumChannels * BitsPerSample/8)
    view.setUint16(34, 16, true); // BitsPerSample
    
    // data sub-chunk
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

// --- Text Generation ---

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

  let attempts = 0;
  // Limit max attempts to the number of TEXT keys
  const maxAttempts = TEXT_KEYS_COUNT; 
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
  
  const fullContents = [...historyContents, { role: 'user', parts: [{ text: systemInstruction + "\n\nUser Prompt: " + prompt }] }];

  // RETRY LOOP
  while (attempts < maxAttempts && !success) {
    if (signal?.aborted) throw new Error("Aborted by user");

    try {
      // Ensure we are looking at a text key
      if (currentKeyIndex >= TEXT_KEYS_COUNT) {
          currentKeyIndex = 0; // Reset to first text key if we wandered
      }
      
      const ai = getClient();
      
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

      success = true;

      // Update Usage for Text Key
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

      // Remove from rate limited set if it succeeds
      if (rateLimitedKeys.has(currentKeyIndex)) {
          rateLimitedKeys.delete(currentKeyIndex);
          notifyListeners();
      }

    } catch (error: any) {
      if (error.message === "Aborted by user" || signal?.aborted) {
          throw error; 
      }

      const isRateLimit = error.message?.includes('429') || 
                          error.status === 429 ||
                          error.toString().includes('Resource has been exhausted');
      
      const isQuotaZero = error.message?.includes('limit: 0');

      if (isRateLimit) {
          rateLimitedKeys.add(currentKeyIndex);
          if (isQuotaZero) {
              console.warn(`[Gemini] Key ${currentKeyIndex + 1} has 0 quota for model ${GEMINI_MODEL}.`);
          } else {
              console.warn(`[Gemini] Key ${currentKeyIndex + 1} hit rate limit.`);
          }
      } else {
          console.warn(`[Gemini] Error on Key ${currentKeyIndex + 1}:`, error.message);
      }

      attempts++;
      
      if (attempts < maxAttempts) {
          switchToNextKey();
          await delay(1000); 
          continue; 
      }
      
      if (attempts >= maxAttempts) {
         onChunk(`\n\n*Error: Unable to generate response. All ${maxAttempts} keys failed. Last error: ${error.message}*`);
         return; 
      }
    }
  }
};

// --- Speech Generation ---

export const generateSpeech = async (text: string, voiceName: string = 'Charon'): Promise<string | null> => {
    // 1. Filter out code blocks to prevent reading code
    const cleanText = text
        .replace(/```[\s\S]*?```/g, '') // Remove multi-line code blocks
        .replace(/`.*?`/g, '') // Remove inline code
        .replace(/<[^>]*>/g, '') // Remove HTML tags just in case
        .trim();

    if (!cleanText || cleanText.length < 2) return null;

    try {
        const ai = getSpeechClient();
        
        // Use single-turn generateContent for TTS
        const response = await ai.models.generateContent({
            model: GEMINI_TTS_MODEL,
            contents: [{ parts: [{ text: cleanText }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        // Dynamic voice name
                        prebuiltVoiceConfig: { voiceName: voiceName }
                    }
                }
            }
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
            // Track Usage for Key 5 (Index 4)
            const usage = response.usageMetadata;
            if (usage) {
                updateTokenUsage(SPEECH_KEY_INDEX, usage.totalTokenCount);
            }
            
            // Convert to WAV immediately for playback
            return base64ToWav(base64Audio);
        }

    } catch (e: any) {
        console.error("[Gemini TTS] Failed to generate speech:", e);
        // We do not fallback for TTS, as it is exclusive to Key 5
        rateLimitedKeys.add(SPEECH_KEY_INDEX);
        notifyListeners();
    }
    return null;
}