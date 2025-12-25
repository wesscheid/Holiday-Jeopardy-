import { GoogleGenAI, Type, Modality } from "@google/genai";
import { GameData } from "../types";

const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey === "undefined") {
    throw new Error("API Key is missing or undefined. Ensure it's set in your deployment environment secrets.");
  }
  return new GoogleGenAI({ apiKey });
};

export const generateGameData = async (customTopic: string = "Christmas Traditions"): Promise<GameData> => {
  try {
    const ai = getClient();
    // Using Pro for complex JSON structure generation
    const modelId = "gemini-3-pro-preview"; 

    const prompt = `Generate a full Jeopardy-style game board specifically about the topic: "${customTopic}". 
      Requirements:
      1. Create exactly 5 unique categories related to "${customTopic}". 
      2. Each category must have exactly 5 questions with dollar values 200, 400, 600, 800, 1000.
      3. Create 1 "Final Jeopardy" question (category, clue, and answer) about "${customTopic}".
      4. Clue format: A statement like "This reindeer is famous for his red nose."
      5. Answer format: A question like "Who is Rudolph?"
      Return ONLY a raw JSON object.`;

    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingBudget: 4000 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            categories: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  questions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        value: { type: Type.INTEGER },
                        clue: { type: Type.STRING },
                        answer: { type: Type.STRING },
                      },
                      required: ["value", "clue", "answer"],
                    },
                  },
                },
                required: ["title", "questions"],
              },
            },
            finalJeopardy: {
              type: Type.OBJECT,
              properties: {
                category: { type: Type.STRING },
                clue: { type: Type.STRING },
                answer: { type: Type.STRING },
              },
              required: ["category", "clue", "answer"],
            },
          },
          required: ["categories", "finalJeopardy"],
        },
      },
    });

    const text = response.text;
    if (text) {
      let cleanJson = text.trim();
      // Remove any markdown formatting if the model persists in adding it
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
      }
      
      const data = JSON.parse(cleanJson) as GameData;
      
      // Ensure IDs and state are properly initialized
      data.categories = data.categories.map((cat, catIdx) => ({
        ...cat,
        id: `cat-${catIdx}-${Date.now()}`,
        questions: (cat.questions || []).map((q, qIdx) => ({
          ...q,
          id: `q-${catIdx}-${qIdx}-${Date.now()}`,
          isAnswered: false
        }))
      }));

      return data;
    }
    
    throw new Error("Received empty response from the AI model.");

  } catch (error) {
    console.error("Game generation error:", error);
    throw error;
  }
};

export const generateHint = async (clue: string, answer: string): Promise<string> => {
  try {
    const ai = getClient();
    const modelId = "gemini-3-flash-preview";
    
    const response = await ai.models.generateContent({
      model: modelId,
      contents: `You are a Jeopardy host helper. 
      Clue: "${clue}"
      Answer: "${answer}"
      Task: Provide a helpful but subtle hint for the players who are stuck. Do not use the answer word itself. Keep it short (max 15 words).`,
    });

    return response.text || "No hint available.";
  } catch (error) {
    console.error("Hint generation failed:", error);
    return "Could not generate a hint.";
  }
};

export const speakText = async (text: string): Promise<AudioBuffer | null> => {
  try {
    const ai = getClient();
    const modelId = "gemini-2.5-flash-preview-tts";

    const response = await ai.models.generateContent({
      model: modelId,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Fenrir' }, 
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) return null;

    const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    const bytes = decode(base64Audio);
    return await decodeAudioData(bytes, outputAudioContext, 24000, 1);

  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
};

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}