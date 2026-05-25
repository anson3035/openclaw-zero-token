/**
 * 跨 provider 車牌辨識引擎 — 公開 API。
 *
 * 用法（lpr-pipeline 在內部使用）：
 *   import { createDefaultDispatcher } from "./recognition-engine/index.js";
 *   const d = createDefaultDispatcher();
 *   const vote = await d.voteDispatch(imagePaths, hint);
 *   if (vote.agreement === "all") boost confidence
 */
import { RecognitionDispatcher } from "./dispatcher.js";
import { GeminiPlateRecognizer } from "./gemini-provider.js";
import { OpenAIPlateRecognizer } from "./openai-provider.js";

export { RecognitionDispatcher } from "./dispatcher.js";
export { OpenAIPlateRecognizer } from "./openai-provider.js";
export { GeminiPlateRecognizer } from "./gemini-provider.js";
export type {
  PlateRecognizer,
  RecognitionResult,
  RecognitionStatus,
  VoteResult,
} from "./types.js";

/**
 * 預設 dispatcher：依環境變數註冊所有可用 provider。
 *
 * - OPENAI_API_KEY 必設 → 永遠註冊 OpenAI provider
 * - GEMINI_API_KEY 選設 → 設定則啟用跨引擎投票
 *
 * 未來新 provider（Claude vision、Qwen-VL、PaddleOCR sidecar）只需加在這裡。
 */
export function createDefaultDispatcher(): RecognitionDispatcher {
  return new RecognitionDispatcher()
    .register(new OpenAIPlateRecognizer())
    .register(new GeminiPlateRecognizer());
}
