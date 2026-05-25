import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import { z } from "zod";
import { loadConfig } from "../config.js";

/**
 * Commercial-grade Taiwan license-plate recognition (ANPR) prompt.
 *
 * v2 — designed to fight LLM overconfidence on low-resolution / oblique
 * plate captures. Forces top-3 candidate enumeration, per-character
 * alternatives, and artifact-aware confidence caps. The system also
 * exposes a requires_human_verification flag that downstream code uses
 * to gate the /send flow.
 */
export function buildLprPrompt(vehicleTypeHint: string = "Unspecified"): string {
  return `# Role
You are a commercial-grade Automated Number Plate Recognition (ANPR) engine specializing in Taiwanese vehicle license plates. Your single most important duty is **honest uncertainty reporting**. A wrong-but-confident answer is worse than admitting you cannot see the plate.

# Context & Domain Knowledge (Taiwanese License Plate Rules)
Enforce MOTC rules:
1. **Character Exclusions**:
   - Latin letters **'I'** and **'O'** are NEVER used in any Taiwanese license plate. If you detect 'I', it is a '1'. If you detect 'O', it is a '0'.
   - In modern 7-character plates, the digit **'4'** is excluded from the numeric sequence.
2. **Standard Formats**:
   - Modern 7-Character: 3 Letters - 4 Digits (e.g., AAA-1122). EV starts with 'E' or 'RE'; taxi often 'T' or 'Y'.
   - Older 6-Character: 2 Letters - 4 Digits (e.g., AB-1234) or 4 Digits - 2 Letters.
   - Motorcycle: 3 Letters - 3 Digits or 2 Letters - 3 Digits.

# CRITICAL: visually-confusable character pairs
You must explicitly list these alternatives for any character that is not pin-sharp:
   B  ↔  8 / E / R / 3
   D  ↔  0 / O (→ 0) / 8
   E  ↔  B / F / G
   F  ↔  E / P / T
   G  ↔  C / 6 / 0 / 8 / E
   M  ↔  N / W / H / A (often confused due to font)
   N  ↔  M / H / R
   Q  ↔  0 / O (→ 0)
   S  ↔  5 / 8 / 6
   Z  ↔  2 / 7
   0  ↔  D / Q / 8 / 6 / 9 / O (→ 0)
   1  ↔  I (→ 1) / T / 7
   2  ↔  Z / 7
   3  ↔  8 / B / E
   5  ↔  S / 6 / 3
   6  ↔  G / 0 / 8 / 5
   8  ↔  B / 0 / 3 / 6 / 9
   9  ↔  0 / 8 / 6 / g

# Execution Pipeline (Chain-of-Thought)
1. **Localization**: locate the plate bounding box. If you cannot localize, set localization_success=false and stop.
2. **Capture-quality scoring**: rate each of these on 0..1 — distance, angle, blur, glare, occlusion. Multiply all five to get capture_quality. This becomes an upper cap on confidence.
3. **Per-character read**: for every character position, list the top alternative read using the confusion table. If any single character has < 0.85 confidence, set is_ambiguous=true.
4. **Cross-frame fusion** (if multiple inputs): for each position, intersect candidates across frames. Disagreement across frames means low confidence — do NOT collapse to a single answer prematurely.
5. **Top-3 hypothesis enumeration**: build the three most likely full plates by combining per-character alternatives. Rank by joint probability.
6. **Syntax validation**: filter any candidate that violates Taiwan rules (I/O, 4 in modern 7-char numerics).
7. **Final commitment**: pick #1 as resolved_plate. Set requires_human_verification=true if:
   - confidence < 0.85, OR
   - is_ambiguous=true, OR
   - top-2 candidates differ by less than 0.20 in probability, OR
   - any artifact severity ≥ 0.5.
8. **Bounding box**: report the plate's location as normalized 0..1 coordinates
   {x, y, w, h} where (x, y) is the top-left of the plate region and (w, h)
   is its width and height as fractions of the full image. This enables the
   pipeline to crop + upscale + re-read for higher confidence.

# Honesty Rules
- DO NOT inflate confidence to please the user. If you can only read 4 of 7 characters clearly, you cannot give 0.8 confidence.
- DO NOT report cross-frame agreement when the frames are all low resolution from the same camera — that is your own bias agreeing with itself, not verification.
- If artifacts dominate (severe distance / angle / blur), prefer placing '?' over guessing.

# Output Specification (STRICT JSON ONLY)
Return a raw JSON object, no markdown. Schema:

{
  "analysis": {
    "localization_success": true,
    "detected_artifacts": ["distance", "angle_distortion", "glare", "motion_blur", "occlusion", "low_resolution", "none"],
    "capture_quality": 0.42,
    "plate_type": "Modern 7-Character / Old 6-Character / Motorcycle / Unknown",
    "raw_visual_text": "the uncorrected text directly read from the image, position by position",
    "plate_bbox": { "x": 0.42, "y": 0.55, "w": 0.18, "h": 0.06 },
    "per_character": [
      { "position": 1, "primary": "B", "alternatives": ["8", "R"], "confidence": 0.9 },
      { "position": 2, "primary": "G", "alternatives": ["E", "C", "6"], "confidence": 0.55 }
    ]
  },
  "candidates": [
    { "license_plate_number": "BGM-9090", "joint_confidence": 0.42, "reasoning": "Per-character primary picks, all Taiwan-rule valid." },
    { "license_plate_number": "BEM-9090", "joint_confidence": 0.18, "reasoning": "Position-2 alternative E swapped." },
    { "license_plate_number": "BGN-9090", "joint_confidence": 0.12, "reasoning": "Position-3 alternative N swapped." }
  ],
  "resolved_plate": {
    "license_plate_number": "BGM-9090",
    "confidence_score": 0.42,
    "is_ambiguous": true,
    "ambiguity_details": "Distance + slight angle limit clarity; positions 2 (G/E/C/6) and 3 (M/N) under 0.85 individual confidence.",
    "requires_human_verification": true
  }
}

# Additional Metadata Hint
- Prioritized vehicle type context: ${vehicleTypeHint}

Remember: zero conversational filler. Output the JSON only. If you are uncertain, that uncertainty MUST be reflected in confidence_score and requires_human_verification — never round up to look decisive.
`;
}

const perCharacterSchema = z.object({
  position: z.number().int(),
  primary: z.string(),
  alternatives: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

const candidateSchema = z.object({
  license_plate_number: z.string(),
  joint_confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const bboxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

export const lprResultSchema = z.object({
  analysis: z.object({
    localization_success: z.boolean(),
    detected_artifacts: z.array(z.string()),
    capture_quality: z.number().min(0).max(1).optional(),
    plate_type: z.string(),
    raw_visual_text: z.string(),
    plate_bbox: bboxSchema.optional(),
    per_character: z.array(perCharacterSchema).optional(),
  }),
  candidates: z.array(candidateSchema).optional(),
  resolved_plate: z.object({
    license_plate_number: z.string(),
    confidence_score: z.number().min(0).max(1),
    is_ambiguous: z.boolean(),
    ambiguity_details: z.string(),
    requires_human_verification: z.boolean().optional(),
  }),
});

export type LprResult = z.infer<typeof lprResultSchema>;
export type LprCandidate = z.infer<typeof candidateSchema>;

let cachedClient: OpenAI | undefined;
function client(): OpenAI {
  if (!cachedClient) cachedClient = new OpenAI({ apiKey: loadConfig().OPENAI_API_KEY });
  return cachedClient;
}

function inferMime(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/**
 * Apply post-hoc confidence caps based on declared artifacts.
 *
 * This is the structural fix for LLM overconfidence: even if the model
 * self-reports 0.9 confidence, severe artifacts force the system to
 * treat the result as needing human review.
 */
function applyConfidenceCaps(result: LprResult): LprResult {
  const artifacts = result.analysis.detected_artifacts;
  const severeArtifacts = new Set([
    "distance",
    "angle_distortion",
    "motion_blur",
    "low_resolution",
    "glare",
    "occlusion",
  ]);
  const severeCount = artifacts.filter((a) => severeArtifacts.has(a)).length;

  // Cap by capture_quality if reported
  const capByQuality = result.analysis.capture_quality ?? 1;
  // Cap by artifact count (each severe artifact knocks 0.1 off ceiling)
  const capByArtifacts = Math.max(0.3, 1 - severeCount * 0.15);

  const ceiling = Math.min(capByQuality, capByArtifacts);
  const cappedConfidence = Math.min(result.resolved_plate.confidence_score, ceiling);

  // Always require human verification if confidence < 0.85 OR ambiguous OR any severe artifact
  const requiresReview =
    result.resolved_plate.requires_human_verification === true ||
    cappedConfidence < 0.85 ||
    result.resolved_plate.is_ambiguous ||
    severeCount > 0;

  return {
    ...result,
    resolved_plate: {
      ...result.resolved_plate,
      confidence_score: cappedConfidence,
      requires_human_verification: requiresReview,
    },
  };
}

/**
 * Run the ANPR engine on one or more images / video frames.
 *
 * Pass multiple images (e.g. extracted from a video) to enable the model's
 * cross-frame verification step. Confidence caps are applied post-hoc to
 * counter LLM overconfidence.
 */
export async function recognizePlate(
  imagePaths: string[],
  vehicleTypeHint: string = "Unspecified",
): Promise<LprResult> {
  if (imagePaths.length === 0) throw new Error("recognizePlate: no images provided");

  const prompt = buildLprPrompt(vehicleTypeHint);
  const imageParts = await Promise.all(
    imagePaths.map(async (p) => {
      const buf = await readFile(p);
      const mime = inferMime(p);
      return {
        type: "image_url" as const,
        image_url: { url: `data:${mime};base64,${buf.toString("base64")}` },
      };
    }),
  );

  const userText =
    imagePaths.length > 1
      ? `Identify the license plate. ${imagePaths.length} frames are provided — but warning: if these are all from the same low-resolution capture, do NOT report cross-frame agreement as verification (that is the same bias agreeing with itself). Apply Step 4 honestly.`
      : "Identify the license plate. There is only one frame — your confidence ceiling is therefore capped by single-frame capture quality. Be honest.";

  const response = await client().chat.completions.create({
    model: loadConfig().OPENAI_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [{ type: "text", text: userText }, ...imageParts],
      },
    ],
    max_tokens: 1200,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = lprResultSchema.parse(JSON.parse(raw));
  return applyConfidenceCaps(parsed);
}

/**
 * Convenience: only returns a plate string if the LPR result is high-confidence
 * AND does not require human verification. Otherwise returns undefined and the
 * caller should ask the user for confirmation.
 */
export async function recognizePlateSimple(
  imagePaths: string[],
  vehicleTypeHint?: string,
): Promise<string | undefined> {
  const r = await recognizePlate(imagePaths, vehicleTypeHint);
  if (r.resolved_plate.requires_human_verification) return undefined;
  if (r.resolved_plate.license_plate_number.includes("?")) return undefined;
  return r.resolved_plate.license_plate_number;
}
