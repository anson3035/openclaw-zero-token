import { dirname, join, basename } from "node:path";
import { cropAndUpscale } from "./image-ops.js";
import { recognizePlate, type LprResult } from "./lpr.js";
import { validatePlate } from "./plate-validator.js";
import { createDefaultDispatcher } from "./recognition-engine/index.js";
import type { VoteResult } from "./recognition-engine/types.js";

export interface PipelineResult {
  lpr: LprResult;
  passes: number;
  /** True when Pass-1 and Pass-2 produced the same plate string. */
  agreement: boolean;
  /** Cross-provider vote (only present when ≥ 2 providers were available). */
  vote?: VoteResult;
  /** True when the resolved plate passes MOTC issuance rules. */
  motcValid: boolean;
  /** Final confidence after agreement and MOTC boosts. */
  finalConfidence: number;
  notes: string[];
}

// Tunables
const HIGH_CONF_SHORT_CIRCUIT = 0.85; // Pass-1 alone is enough when this clear
const AGREEMENT_MULTIPLIER = 1.5; // when both passes agree
const AGREEMENT_CEILING = 0.95;
const MOTC_VALID_BOOST = 0.10;
const MOTC_INVALID_MULTIPLIER = 0.5;

/**
 * Two-pass ANPR pipeline that mitigates LLM overconfidence and
 * underconfidence simultaneously:
 *
 *   Pass-1 — read on full image; capture bbox.
 *   Pass-2 — crop to bbox + 4× upscale + sharpen + normalise; re-read.
 *
 *   Agreement boost — if both passes produce the same plate, multiply
 *   confidence by 1.5 (capped at 0.95). The two passes are based on
 *   different visual inputs (full vs cropped+zoomed), so this IS real
 *   independent verification, unlike showing the same model the same
 *   image multiple times.
 *
 *   MOTC validation — if the resolved plate passes Taiwan issuance
 *   rules (no I/O, no digit-4 in modern 7-char, valid format/prefix),
 *   add +0.10 to confidence. If it FAILS the rules, multiply by 0.5
 *   and force requires_human_verification.
 */
export async function runLprPipeline(
  imagePaths: string[],
  vehicleTypeHint: string = "Unspecified",
): Promise<PipelineResult> {
  const notes: string[] = [];
  if (imagePaths.length === 0) throw new Error("runLprPipeline: no images");

  // ---- Pass 1: full image ----
  const pass1 = await recognizePlate(imagePaths, vehicleTypeHint);

  // Short-circuit if already very high confidence
  if (pass1.resolved_plate.confidence_score >= HIGH_CONF_SHORT_CIRCUIT) {
    const v = validatePlate(pass1.resolved_plate.license_plate_number);
    const motcAdj = applyMotcAdjustment(pass1, v.valid, notes);
    notes.unshift("Pass-1 already ≥ 0.85, short-circuited");
    return {
      lpr: motcAdj,
      passes: 1,
      agreement: true,
      motcValid: v.valid,
      finalConfidence: motcAdj.resolved_plate.confidence_score,
      notes,
    };
  }

  // ---- Pass 2: crop & upscale ----
  const bbox = pass1.analysis.plate_bbox;
  if (!bbox) {
    notes.push("Pass-1 returned no plate_bbox; cannot run zoomed second pass");
    const v = validatePlate(pass1.resolved_plate.license_plate_number);
    const motcAdj = applyMotcAdjustment(pass1, v.valid, notes);
    return {
      lpr: motcAdj,
      passes: 1,
      agreement: false,
      motcValid: v.valid,
      finalConfidence: motcAdj.resolved_plate.confidence_score,
      notes,
    };
  }

  const cropPaths: string[] = [];
  for (const p of imagePaths) {
    try {
      const out = join(dirname(p), `${basename(p)}.lprcrop.jpg`);
      await cropAndUpscale(p, bbox, out, { upscale: 4, marginFrac: 0.35 });
      cropPaths.push(out);
    } catch (err) {
      notes.push(`crop failed for ${basename(p)}: ${(err as Error).message}`);
    }
  }

  if (cropPaths.length === 0) {
    notes.push("All crops failed; falling back to Pass-1 result");
    const v = validatePlate(pass1.resolved_plate.license_plate_number);
    const motcAdj = applyMotcAdjustment(pass1, v.valid, notes);
    return {
      lpr: motcAdj,
      passes: 1,
      agreement: false,
      motcValid: v.valid,
      finalConfidence: motcAdj.resolved_plate.confidence_score,
      notes,
    };
  }

  const pass2 = await recognizePlate(cropPaths, vehicleTypeHint);
  notes.push(`Pass-2 ran on ${cropPaths.length} cropped+upscaled image(s) (4× zoom)`);

  // ---- Agreement check ----
  const p1Plate = pass1.resolved_plate.license_plate_number;
  const p2Plate = pass2.resolved_plate.license_plate_number;
  const agreement = p1Plate === p2Plate && !p1Plate.includes("?");

  let merged: LprResult;
  if (agreement) {
    const better =
      pass2.resolved_plate.confidence_score >= pass1.resolved_plate.confidence_score
        ? pass2
        : pass1;
    const boosted = Math.min(
      AGREEMENT_CEILING,
      better.resolved_plate.confidence_score * AGREEMENT_MULTIPLIER,
    );
    notes.push(
      `Agreement boost: ${p1Plate} == ${p2Plate}; confidence ${better.resolved_plate.confidence_score.toFixed(2)} × ${AGREEMENT_MULTIPLIER} → ${boosted.toFixed(2)} (capped at ${AGREEMENT_CEILING})`,
    );
    merged = {
      ...better,
      resolved_plate: {
        ...better.resolved_plate,
        confidence_score: boosted,
        is_ambiguous: boosted < AGREEMENT_CEILING ? better.resolved_plate.is_ambiguous : false,
        requires_human_verification: boosted < 0.85,
      },
    };
  } else {
    notes.push(
      `Disagreement: Pass-1="${p1Plate}" vs Pass-2="${p2Plate}" — flagging for human review`,
    );
    const better =
      pass2.resolved_plate.confidence_score > pass1.resolved_plate.confidence_score
        ? pass2
        : pass1;
    merged = {
      ...better,
      resolved_plate: {
        ...better.resolved_plate,
        is_ambiguous: true,
        ambiguity_details: `Two-pass disagreement (full="${p1Plate}", zoomed="${p2Plate}"). ${better.resolved_plate.ambiguity_details}`,
        requires_human_verification: true,
      },
    };
  }

  // ---- MOTC pattern validation ----
  const v = validatePlate(merged.resolved_plate.license_plate_number);
  let motcAdj = applyMotcAdjustment(merged, v.valid, notes);

  // ---- Pass-3 (optional): cross-provider vote ----
  // 只在 (a) 有第二個 provider enabled，且 (b) 目前信心仍 < 0.95 時觸發，
  // 避免不必要的 API 成本。投票本身是真正獨立的視覺證據（不同模型、不同視覺架構）。
  let vote: VoteResult | undefined;
  if (motcAdj.resolved_plate.confidence_score < 0.95) {
    const dispatcher = createDefaultDispatcher();
    if (dispatcher.enabledRecognizers().length >= 2) {
      try {
        vote = await dispatcher.voteDispatch(cropPaths.length > 0 ? cropPaths : imagePaths, vehicleTypeHint);
        notes.push(
          `Pass-3 cross-provider vote: ${vote.votes.length} providers, agreement=${vote.agreement}`,
        );

        // 一致 → boost 信心；分歧 → 強制 human verification
        if (vote.agreement === "all" || vote.agreement === "majority") {
          const consensusPlate = vote.consensus.text;
          if (consensusPlate === motcAdj.resolved_plate.license_plate_number) {
            // 主流程結果與投票結果完全一致 → 真正獨立 verification
            const before = motcAdj.resolved_plate.confidence_score;
            const boosted = Math.min(0.99, before * 1.2);
            notes.push(
              `Cross-provider agreement on "${consensusPlate}" → confidence ${before.toFixed(2)} × 1.20 → ${boosted.toFixed(2)} (capped 0.99)`,
            );
            motcAdj = {
              ...motcAdj,
              resolved_plate: {
                ...motcAdj.resolved_plate,
                confidence_score: boosted,
                is_ambiguous: false,
                requires_human_verification: boosted < 0.85,
              },
            };
          } else {
            // 投票一致但與主流程不同 → 採用投票結果
            notes.push(
              `Cross-provider voted "${consensusPlate}" but pipeline had "${motcAdj.resolved_plate.license_plate_number}" — overriding with vote consensus`,
            );
            motcAdj = {
              ...motcAdj,
              resolved_plate: {
                ...motcAdj.resolved_plate,
                license_plate_number: consensusPlate,
                confidence_score: vote.consensus.confidence,
                requires_human_verification: vote.consensus.confidence < 0.85,
                ambiguity_details: `Vote override: pipeline read "${motcAdj.resolved_plate.license_plate_number}" but ${vote.agreement} of ${vote.votes.length} providers voted "${consensusPlate}".`,
              },
            };
          }
        } else if (vote.agreement === "split") {
          // 不同 provider 給出不同答案 — 強烈訊號至少一方錯
          notes.push(
            `Cross-provider DISAGREEMENT (providers split) → flagging for human review`,
          );
          motcAdj = {
            ...motcAdj,
            resolved_plate: {
              ...motcAdj.resolved_plate,
              confidence_score: motcAdj.resolved_plate.confidence_score * 0.7,
              is_ambiguous: true,
              requires_human_verification: true,
              ambiguity_details: `${motcAdj.resolved_plate.ambiguity_details} | Providers disagreed: ${vote.votes
                .map((vt) => `${vt.provider}="${vt.text}"`)
                .join(", ")}.`,
            },
          };
        }
      } catch (err) {
        notes.push(`Pass-3 vote skipped: ${(err as Error).message}`);
      }
    }
  }

  return {
    lpr: motcAdj,
    passes: vote ? 3 : 2,
    agreement,
    motcValid: v.valid,
    finalConfidence: motcAdj.resolved_plate.confidence_score,
    notes,
    vote,
  };
}

function applyMotcAdjustment(lpr: LprResult, valid: boolean, notes: string[]): LprResult {
  const before = lpr.resolved_plate.confidence_score;
  let after: number;
  let requiresVerify = lpr.resolved_plate.requires_human_verification ?? before < 0.85;

  if (valid) {
    after = Math.min(0.99, before + MOTC_VALID_BOOST);
    notes.push(`MOTC valid → +${MOTC_VALID_BOOST} boost (${before.toFixed(2)} → ${after.toFixed(2)})`);
    if (after >= 0.85) requiresVerify = false;
  } else {
    after = before * MOTC_INVALID_MULTIPLIER;
    notes.push(`MOTC INVALID → ×${MOTC_INVALID_MULTIPLIER} penalty (${before.toFixed(2)} → ${after.toFixed(2)})`);
    requiresVerify = true;
  }

  return {
    ...lpr,
    resolved_plate: {
      ...lpr.resolved_plate,
      confidence_score: after,
      requires_human_verification: requiresVerify,
    },
  };
}
