import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import { z } from "zod";
import { loadConfig } from "../config.js";
import type { AnalyzedViolation, ViolationCategory } from "../types.js";
import { recognizePlate, type LprResult } from "./lpr.js";

let cachedClient: OpenAI | undefined;
function client(): OpenAI {
  if (!cachedClient) cachedClient = new OpenAI({ apiKey: loadConfig().OPENAI_API_KEY });
  return cachedClient;
}

const analysisSchema = z.object({
  category: z.enum(["traffic", "environment", "building", "condominium"]),
  subject: z.string(),
  description: z.string(),
  identifiers: z.object({
    licensePlate: z.string().optional(),
    structureDescription: z.string().optional(),
    wasteType: z.string().optional(),
    occupiedArea: z.string().optional(),
  }),
  confidence: z.enum(["high", "medium", "low"]),
  evidenceGaps: z.array(z.string()),
});

const SYSTEM_PROMPT = `你是台灣行政法規檢舉稽核專家。分析使用者上傳的影像，識別違規行為並產出結構化 JSON。

分類規則：
- traffic：交通違規（違停、闖紅燈、未禮讓行人、逆向等）
- environment：環保違規（亂丟垃圾、棄置廢棄物、噪音、空污）
- building：建築違規（違章建築、頂樓加蓋、未許可施工）
- condominium：公寓大廈違規（佔用公共區域、違法隔間、逃生通道堵塞）

必須輸出嚴格 JSON 物件，欄位：
{
  "category": "traffic|environment|building|condominium",
  "subject": "違規客體簡述（如：黑色機車車牌 ABC-1234）",
  "description": "繁體中文描述違規事實，包含客體特徵、位置、行為",
  "identifiers": {
    "licensePlate": "若有車牌（格式：ABC-1234 或 1234-AB）",
    "structureDescription": "若為建築違規",
    "wasteType": "若為廢棄物",
    "occupiedArea": "若為佔用"
  },
  "confidence": "high|medium|low",
  "evidenceGaps": ["列出證據不足之處，如：車牌模糊、時間戳記缺失、違規事實不明顯"]
}

僅輸出 JSON，不要 markdown 程式碼框。`;

function inferMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export async function analyzeMedia(
  filePath: string,
  userHint?: string,
): Promise<AnalyzedViolation> {
  const buf = await readFile(filePath);
  const base64 = buf.toString("base64");
  const mime = inferMimeType(filePath);

  const userText = userHint
    ? `分析此影像並識別違規行為。使用者補充：「${userHint}」`
    : "分析此影像並識別違規行為。";

  const response = await client().chat.completions.create({
    model: loadConfig().OPENAI_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      },
    ],
    max_tokens: 800,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = analysisSchema.parse(JSON.parse(raw));
  return parsed satisfies AnalyzedViolation;
}

export function overrideCategory(
  analysis: AnalyzedViolation,
  category: ViolationCategory,
): AnalyzedViolation {
  return { ...analysis, category };
}

/**
 * For traffic violations, run the commercial-grade ANPR engine over the
 * provided images (single photo or multiple video frames) to upgrade the
 * plate identifier with cross-frame verification + Taiwan plate-rule
 * correction. Returns the enriched analysis + raw LPR result.
 *
 * Failures here do not throw — the original analysis is returned unchanged
 * so the main pipeline keeps working even if the LPR call is rate-limited
 * or returns malformed JSON.
 */
export interface EnrichmentResult {
  analysis: AnalyzedViolation;
  lpr?: LprResult;
  /** True if the LPR result is reliable enough to use without user confirmation. */
  trustworthy: boolean;
}

export async function enrichPlateWithLpr(
  analysis: AnalyzedViolation,
  imagePaths: string[],
): Promise<EnrichmentResult> {
  if (analysis.category !== "traffic" || imagePaths.length === 0) {
    return { analysis, trustworthy: false };
  }
  try {
    const hint = analysis.subject || "Unspecified";
    const lpr = await recognizePlate(imagePaths, hint);

    const plate = lpr.resolved_plate.license_plate_number;
    const requiresReview = lpr.resolved_plate.requires_human_verification === true;
    const hasPlaceholder = plate.includes("?");
    // Tightened from 0.6 → 0.85; honest LPR results below this almost always need review.
    const isHighConfidence = lpr.resolved_plate.confidence_score >= 0.85;
    const trustworthy = !requiresReview && !hasPlaceholder && isHighConfidence;

    if (!trustworthy) {
      // Surface the LPR's best guess but do NOT overwrite the identifier
      // when we don't trust it — caller must ask the user to confirm.
      return { analysis, lpr, trustworthy: false };
    }

    return {
      analysis: {
        ...analysis,
        identifiers: { ...analysis.identifiers, licensePlate: plate },
      },
      lpr,
      trustworthy: true,
    };
  } catch (err) {
    console.error("[lpr] enrichment failed:", (err as Error).message);
    return { analysis, trustworthy: false };
  }
}
