/**
 * OpenAI GPT-4o vision provider（包裝既有的 LPR v3 二階段 pipeline）。
 *
 * 注意：此 provider 內部仍呼叫 runLprPipeline()，所以包含 Pass-1 全圖 +
 * Pass-2 裁切升頻 + MOTC 驗證。本檔不重複實作 — 只把結果轉成統一 RecognitionResult。
 */
import { recognizePlate } from "../lpr.js";
import type { PlateRecognizer, RecognitionResult } from "./types.js";

export class OpenAIPlateRecognizer implements PlateRecognizer {
  readonly name = "openai-gpt4o";

  isEnabled(): boolean {
    return Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 10);
  }

  async recognize(imagePaths: string[], vehicleTypeHint?: string): Promise<RecognitionResult> {
    const start = Date.now();
    try {
      // 注意：這裡直接呼叫底層 recognizePlate（單 pass）而非 runLprPipeline，
      // 因為 lpr-pipeline.ts 才是「pass-1 + pass-2 + 投票」的協調者。
      // 避免 dispatcher 又呼叫 pipeline 造成無限遞迴。
      const lpr = await recognizePlate(imagePaths, vehicleTypeHint ?? "Unspecified");
      const plate = lpr.resolved_plate.license_plate_number;
      const conf = lpr.resolved_plate.confidence_score;
      const requiresReview = lpr.resolved_plate.requires_human_verification === true;

      return {
        status: requiresReview || conf < 0.85 ? "low_confidence" : "success",
        text: plate,
        confidence: conf,
        latencyMs: Date.now() - start,
        provider: this.name,
        metadata: {
          plateType: lpr.analysis.plate_type,
          artifacts: lpr.analysis.detected_artifacts,
          captureQuality: lpr.analysis.capture_quality,
          candidates: lpr.candidates,
          rawOcr: lpr.analysis.raw_visual_text,
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
