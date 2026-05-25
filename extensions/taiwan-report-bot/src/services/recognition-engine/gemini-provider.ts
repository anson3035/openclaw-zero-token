/**
 * Google Gemini vision provider — 為跨引擎投票提供獨立的視覺判斷。
 *
 * 為何加 Gemini：Gemini 與 GPT-4o 是**不同訓練資料、不同視覺架構**的模型。
 * 當兩者對同一張車牌讀出相同結果時，那不是模型自我背書（同一模型再讀一次），
 * 而是真正的獨立 verification — 信心可大幅提升。當兩者不一致時，幾乎必定
 * 至少一方視覺幻覺，需人工確認。
 */
import { readFile } from "node:fs/promises";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { loadConfig } from "../../config.js";
import type { PlateRecognizer, RecognitionResult } from "./types.js";

const PROMPT_TEMPLATE = (hint: string): string => `# Role
You are a commercial Taiwanese license plate recognition (ANPR) engine.
Read the plate(s) in the image(s).

# Taiwan plate rules (enforce strictly)
- Letters 'I' and 'O' are NEVER used → treat as '1' and '0'.
- Modern 7-character plates (3 letters + 4 digits): digit '4' is excluded from the numeric section.
- Formats:
  - Modern 7-char: 3 letters - 4 digits (e.g. ABC-1235). EV prefix 'E*', rental EV 'RE*', taxi 'T*'/'Y*'.
  - Older 6-char: 2L-4D or 4D-2L.
  - Motorcycle: 3L-3D or 2L-3D.

# Honesty
Be calibrated. Distance, angle, blur, glare, low resolution → lower confidence.
Don't inflate confidence just to look decisive.

# Vehicle type hint
${hint}

# Output (strict JSON only, no markdown)
{
  "license_plate_number": "XXX-1234 (or 'AB?-1234' with ? for illegible char)",
  "confidence": 0.0-1.0,
  "plate_type": "Modern 7-Character | Old 6-Character | Motorcycle | Unknown",
  "artifacts": ["distance", "angle_distortion", "glare", "motion_blur", "low_resolution", "occlusion", "none"],
  "raw_visual_text": "the text as raw OCR before Taiwan-rule correction"
}`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    license_plate_number: { type: "string" },
    confidence: { type: "number" },
    plate_type: { type: "string" },
    artifacts: { type: "array", items: { type: "string" } },
    raw_visual_text: { type: "string" },
  },
  required: ["license_plate_number", "confidence"],
};

interface GeminiResponse {
  license_plate_number?: string;
  confidence?: number;
  plate_type?: string;
  artifacts?: string[];
  raw_visual_text?: string;
}

let cachedClient: GoogleGenerativeAI | undefined;

function getClient(apiKey: string): GoogleGenerativeAI {
  if (!cachedClient) cachedClient = new GoogleGenerativeAI(apiKey);
  return cachedClient;
}

export class GeminiPlateRecognizer implements PlateRecognizer {
  readonly name = "gemini";

  isEnabled(): boolean {
    return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 10);
  }

  async recognize(imagePaths: string[], vehicleTypeHint?: string): Promise<RecognitionResult> {
    const start = Date.now();
    try {
      const cfg = loadConfig();
      if (!cfg.GEMINI_API_KEY) {
        return {
          status: "error",
          text: "",
          confidence: 0,
          latencyMs: 0,
          provider: this.name,
          metadata: { error: "GEMINI_API_KEY not set" },
        };
      }

      const client = getClient(cfg.GEMINI_API_KEY);
      const model = client.getGenerativeModel({
        model: cfg.GEMINI_MODEL,
        generationConfig: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          responseMimeType: "application/json",
          // Gemini 1.5+ 支援 responseSchema
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          responseSchema: RESPONSE_SCHEMA as any,
        },
      });

      const imageParts = await Promise.all(
        imagePaths.map(async (p) => {
          const buf = await readFile(p);
          const mime = p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
          return {
            inlineData: { data: buf.toString("base64"), mimeType: mime },
          };
        }),
      );

      const prompt = PROMPT_TEMPLATE(vehicleTypeHint ?? "Unspecified");
      const result = await model.generateContent([prompt, ...imageParts]);
      const text = result.response.text();
      const parsed = JSON.parse(text) as GeminiResponse;

      const plate = parsed.license_plate_number ?? "";
      const conf = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
      const hasPlaceholder = plate.includes("?");

      return {
        status: hasPlaceholder || conf < 0.85 ? "low_confidence" : "success",
        text: plate,
        confidence: conf,
        latencyMs: Date.now() - start,
        provider: this.name,
        metadata: {
          plateType: parsed.plate_type,
          artifacts: parsed.artifacts ?? [],
          rawOcr: parsed.raw_visual_text,
          model: cfg.GEMINI_MODEL,
        },
      };
    } catch (err) {
      return {
        status: "error",
        text: "",
        confidence: 0,
        latencyMs: Date.now() - start,
        provider: this.name,
        metadata: { error: (err as Error).message },
      };
    }
  }
}
