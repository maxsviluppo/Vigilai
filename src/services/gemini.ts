import { GoogleGenAI, Type } from "@google/genai";
import { AlertTrigger } from "../types";

export interface DetectionResult {
  threatLevel: "low" | "medium" | "high";
  detectedEvents: string[];
  description: string;
  isEmergency: boolean;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const analyzeFrame = async (
  base64Image: string, 
  triggers: AlertTrigger[] = ["intrusion", "violence"],
  location: string = "Area monitorata",
  modelId: string = "gemini-1.5-flash"
): Promise<DetectionResult> => {
  try {
    // Clean base64 data if it contains the prefix
    const cleanBase64 = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;

    const triggerDescriptions: Record<string, string> = {
      intrusion: "Intrusione non autorizzata o presenza sospetta.",
      violence: "Rapine, aggressioni, armi (pistole, coltelli, mazze).",
      fire: "Fiamme libere o incendio.",
      smoke: "Fumo denso.",
      safety_gear: "Mancato uso di caschi/DPI.",
      fall: "Persone a terra."
    };

    const activePrompts = triggers.map((t) => triggerDescriptions[t] || t).join(" ");

    const prompt = `Analizza questa immagine di sicurezza (${location}).
    OBIETTIVI: ${activePrompts}
    
    Rispondi SOLO in formato JSON:
    {
      "threatLevel": "low" | "medium" | "high",
      "detectedEvents": string[],
      "description": "breve descrizione tecnica in italiano",
      "isEmergency": boolean
    }
    
    CRITERIO EMERGENZA (isEmergency=true): Rapina (volto coperto e armi), violenza in corso, o fiamme.`;

    const response = await ai.models.generateContent({
      model: modelId,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } },
            { text: prompt }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            threatLevel: { type: Type.STRING, enum: ["low", "medium", "high"] },
            detectedEvents: { type: Type.ARRAY, items: { type: Type.STRING } },
            description: { type: Type.STRING },
            isEmergency: { type: Type.BOOLEAN },
          },
          required: ["threatLevel", "detectedEvents", "description", "isEmergency"],
        },
      },
      // Safety settings are part of config in this SDK
      // but the tool-chain often expects them at top level or inside config.
      // According to skill, it's just model, contents, and config.
    });

    const text = response.text;
    if (!text) throw new Error("Risposta AI vuota");
    
    return JSON.parse(text);
  } catch (error: any) {
    console.error("AI Analysis Error:", error.message);
    
    return {
      threatLevel: "low",
      detectedEvents: [],
      description: `Errore analisi: ${error.message}`,
      isEmergency: false,
    };
  }
};
