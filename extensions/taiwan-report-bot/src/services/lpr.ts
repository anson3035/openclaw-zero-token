import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import { z } from "zod";
import { loadConfig } from "../config.js";

/**
 * Commercial-grade Taiwan license-plate recognition (ANPR) prompt.
 * Port of get_commercial_lpr_prompt() — kept verbatim so the model behaviour
 * stays consistent with the original Python reference implementation.
 */
export function buildLprPrompt(vehicleTypeHint: string = "Unspecified"): string {
  return `# Role
You are a commercial-grade Automated Number Plate Recognition (ANPR) engine specializing in Taiwanese vehicle license plates. Your objective is to analyze the provided image(s) or video frames and extract the highly accurate license plate number under challenging visual conditions.

# Context & Domain Knowledge (Taiwanese License Plate Rules)
You must strictly enforce the official regulations of the Ministry of Transportation and Communications (MOTC) in Taiwan to fix OCR hallucinations:
1. **Character Exclusions**:
   - The Latin letters **'I'** and **'O'** are NEVER used in any Taiwanese license plate to avoid confusion with '1' and '0'. If you detect 'I', it is a '1'. If you detect 'O', it is a '0'.
   - In modern 7-character plates, the number **'4'** is entirely excluded from the numeric sequence.
2. **Standard Formats**:
   - **Modern 7-Character (Most Common)**: 3 Letters - 4 Digits (e.g., AAA-1122).
     * Note: Electric Vehicles (EV) use 'E' as the first letter (e.g., EAB-1234, REA-1234 for rentals). Taxis often start with 'T' or 'Y'.
   - **Older 6-Character**: 2 Letters - 4 Digits (e.g., AB-1234) or 4 Digits - 2 Letters (e.g., 1234-AB).
   - **Light/Heavy Motorcycles**: 3 Letters - 3 Digits (e.g., AAA-123) or 2 Letters - 3 Digits.

# Execution Pipeline (Chain-of-Thought)
Before generating the final output, you must perform the following analytical steps internally:
1. **Localization**: Identify the vehicle location and crop your attention to the bounding box of the license plate.
2. **Visual Artifact Analysis**: Identify any motion blur, headlight/sun glare, perspective distortion, or low-light shadows affecting character legibility.
3. **Cross-Frame Verification (If multiple inputs exist)**: Compare characters across sequential frames to filter out transient noise or reflections.
4. **Syntax Correction**: Align the raw visual text with the Taiwanese plate rules mentioned above (e.g., change 'B' to '8' if it appears in the numeric section).

# Output Specification (STRICT JSON ONLY)
You must return a raw JSON object and nothing else. Do not wrap the JSON in markdown code blocks. The JSON must follow this exact schema:

{
  "analysis": {
    "localization_success": true,
    "detected_artifacts": ["glare", "motion_blur", "angle_distortion", "none"],
    "plate_type": "Modern 7-Character / Old 6-Character / Motorcycle / Unknown",
    "raw_visual_text": "The uncorrected text string directly read from the image"
  },
  "resolved_plate": {
    "license_plate_number": "The final corrected number in standard format with dash, e.g., 'ABC-1235'. Use '?' for completely illegible characters, e.g., 'AB?-1235'",
    "confidence_score": 0.95,
    "is_ambiguous": false,
    "ambiguity_details": "If is_ambiguous is true, explain which characters are uncertain and provide alternatives (e.g., 'Last digit could be 3 or 8 due to screw obstruction'). Otherwise, leave empty."
  }
}

# Additional Metadata Hint
- Prioritized vehicle type context for this request: ${vehicleTypeHint}

Remember: Zero conversational filler. Respond with the validated JSON object only.
`;
}

export const lprResultSchema = z.object({
  analysis: z.object({
    localization_success: z.boolean(),
    detected_artifacts: z.array(z.string()),
    plate_type: z.string(),
    raw_visual_text: z.string(),
  }),
  resolved_plate: z.object({
    license_plate_number: z.string(),
    confidence_score: z.number().min(0).max(1),
    is_ambiguous: z.boolean(),
    ambiguity_details: z.string(),
  }),
});

export type LprResult = z.infer<typeof lprResultSchema>;

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
 * Run the ANPR engine on one or more images / video frames.
 *
 * Pass multiple images (e.g. extracted from a video) to enable the model's
 * cross-frame verification step (Chain-of-Thought §3).
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
      ? `Identify the license plate. ${imagePaths.length} sequential frames are provided — apply cross-frame verification to filter transient noise.`
      : "Identify the license plate from the provided image following the rules in your system prompt.";

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
    max_tokens: 600,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  return lprResultSchema.parse(JSON.parse(raw));
}

/** Convenience: extract just the license plate string. */
export async function recognizePlateSimple(
  imagePaths: string[],
  vehicleTypeHint?: string,
): Promise<string | undefined> {
  const r = await recognizePlate(imagePaths, vehicleTypeHint);
  if (!r.resolved_plate.license_plate_number || r.resolved_plate.license_plate_number.includes("?")) {
    return undefined;
  }
  return r.resolved_plate.license_plate_number;
}
