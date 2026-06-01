import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import { z } from "zod";
import { loadConfig } from "../config.js";
import type { AnalyzedViolation, ViolationCategory } from "../types.js";
import { runLprPipeline, type PipelineResult } from "./lpr-pipeline.js";
import type { LprResult } from "./lpr.js";

let cachedClient: OpenAI | undefined;
function client(): OpenAI {
  if (!cachedClient) cachedClient = new OpenAI({ apiKey: loadConfig().OPENAI_API_KEY });
  return cachedClient;
}

const vehicleTypeSchema = z.enum([
  "car",
  "suv",
  "truck",
  "bus",
  "motorcycle_light",
  "motorcycle_heavy",
  "ev_car",
  "ev_motorcycle",
  "rental_ev",
  "taxi",
  "government",
  "police",
  "unknown",
]);

const sceneTypeSchema = z.enum([
  "red_line",
  "yellow_line",
  "sidewalk",
  "arcade",
  "wheelchair_path",
  "fire_facility",
  "bus_stop",
  "intersection",
  "disabled_parking",
  "motorcycle_grid",
  "metered_parking",
  "designated_parking",
  "private_property",
  "moving_violation",
  "unknown",
]);

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
  vehicleType: vehicleTypeSchema.optional(),
  sceneType: sceneTypeSchema.optional(),
  signTexts: z.array(z.string()).optional(),
  privacyRegions: z
    .array(
      z.object({
        type: z.enum(["face", "plate", "address", "person", "other"]),
        reason: z.string(),
        bbox: z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          w: z.number().min(0).max(1),
          h: z.number().min(0).max(1),
        }),
      }),
    )
    .optional(),
  additionalPlates: z
    .array(
      z.object({
        licensePlate: z.string(),
        vehicleType: vehicleTypeSchema.optional(),
        description: z.string().optional(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .optional(),
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
  "evidenceGaps": ["列出證據不足之處，如：車牌模糊、時間戳記缺失、違規事實不明顯"],
  "vehicleType": "選一：car/suv/truck/bus/motorcycle_light/motorcycle_heavy/ev_car/ev_motorcycle/rental_ev/taxi/government/police/unknown",
  "sceneType": "選一：red_line/yellow_line/sidewalk/arcade/wheelchair_path/fire_facility/bus_stop/intersection/disabled_parking/motorcycle_grid/metered_parking/designated_parking/private_property/moving_violation/unknown",
  "signTexts": ["畫面中所有可見之告示牌、路標、看板、路面標字文字。例：請留輪椅通道、禁止停車、24 小時違規拖吊。沒有則回 []"],
  "privacyRegions": [
    {
      "type": "face|plate|address|person|other",
      "reason": "為何需馬賽克（例：路人臉部、第三方車牌、住址門牌）",
      "bbox": {"x": 0.25, "y": 0.55, "w": 0.10, "h": 0.04}
    }
  ]
}

additionalPlates 提取準則：
- 若畫面有**多輛違規車輛**（如騎樓滿排機車、紅線一整列違停），
  將主車牌放入 identifiers.licensePlate，其餘違規車輛放入此陣列
- 只列**有同樣違規**的車輛（場景相同則違規相同）
- 旁觀車輛、合法停車的不列入此陣列
- 沒有時回 []

privacyRegions 提取準則：
- **第三方車牌**：畫面中**非違規當事人**之其他車牌（如旁觀車輛、合法停車）。違規車牌**不馬賽克**。
- **人臉**：與違規無關之路人、行人、商家。違規駕駛人臉可保留（如闖紅燈影像）。
- **住址門牌**：背景明顯可見之第三人住處門牌。違規地點本身之路名/門牌則保留。
- **第三人身形**：完整入鏡之路人。
- 沒有需馬賽克者則回 []。
- bbox 為 normalized 0..1 座標。

signTexts 提取準則：
- 完整讀出所有可辨識文字，繁體中文優先
- 包含：路邊豎立告示、貼於牆面之 A4 通知、紅色禁停標誌、騎樓「請勿停車」貼紙、路面噴字（如「殘」、「機」、「禁停」）、招牌
- 不包含：商號招牌（與違規無關）、車牌（已在 identifiers）、新年春聯等裝飾
- 多項以陣列分開：["請留輪椅通道", "請勿停車"]

vehicleType 判斷準則：
- 綠色 EV 牌（含「電動車」中文標）+ 汽車 → ev_car；機車 → ev_motorcycle
- 牌首字母 RE 開頭 → rental_ev；T/Y 開頭 → taxi；E 開頭 → ev_*
- 警車標誌、警徽、POLICE 字樣 → police（**不視為一般民眾檢舉違規**）
- 牌「使」「外」字樣 或「公務」標 → government
- 機車牌格式 3L-3D / 2L-3D → motorcycle_light；大型重型黃牌 → motorcycle_heavy

sceneType 判斷準則：
- 紅色路緣標線、紅色磚紋 → red_line（注意：紅磚人行道**不是**紅線！）
- 黃色路緣標線 → yellow_line
- 一般人行道（含視障引導磚但無「請留輪椅通」標示）→ sidewalk
- 騎樓（建築物柱列下方有屋簷）→ arcade
- 有「請留輪椅通」「無障礙通道」標示 → wheelchair_path
- 機車格邊線可見（白色矩形格）→ motorcycle_grid
- 計時收費繳費柱可見 → metered_parking
- 派出所、警局、軍營等權威場域 → private_property
- 闖紅燈 / 未禮讓 / 蛇行等動態 → moving_violation

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
  pipeline?: PipelineResult;
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
    const pipeline = await runLprPipeline(imagePaths, hint);
    const lpr = pipeline.lpr;

    const plate = lpr.resolved_plate.license_plate_number;
    const requiresReview = lpr.resolved_plate.requires_human_verification === true;
    const hasPlaceholder = plate.includes("?");
    const isHighConfidence = pipeline.finalConfidence >= 0.85;
    const trustworthy = !requiresReview && !hasPlaceholder && isHighConfidence;

    if (!trustworthy) {
      return { analysis, lpr, pipeline, trustworthy: false };
    }

    return {
      analysis: {
        ...analysis,
        identifiers: { ...analysis.identifiers, licensePlate: plate },
      },
      lpr,
      pipeline,
      trustworthy: true,
    };
  } catch (err) {
    console.error("[lpr] enrichment failed:", (err as Error).message);
    return { analysis, trustworthy: false };
  }
}
