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
  location: string = "Area monitorata"
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
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: cleanBase64 } },
          { text: prompt }
        ]
      },
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
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT" as any, threshold: "BLOCK_NONE" as any },
          { category: "HARM_CATEGORY_HATE_SPEECH" as any, threshold: "BLOCK_NONE" as any },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT" as any, threshold: "BLOCK_NONE" as any },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT" as any, threshold: "BLOCK_NONE" as any },
        ]
      }
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
