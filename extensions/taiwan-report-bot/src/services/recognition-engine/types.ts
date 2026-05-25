/**
 * 跨 provider 辨識引擎 — 統一型別
 * ============================================
 * 把 5 大辨識架構（PARSeq / CRNN+CTC / VLM / FOTS / KAN）的 Python 骨架
 * 設計概念落地到 TS 生產環境：先實作 2 個雲端 VLM provider（OpenAI、Gemini），
 * 透過 SmartDispatcher 做跨引擎投票，提升真實辨識信心。
 */
export type RecognitionStatus = "success" | "low_confidence" | "error";

export interface RecognitionResult {
  status: RecognitionStatus;
  /** 辨識出的字串（車牌、單據號…） */
  text: string;
  /** 0..1 信心分數 */
  confidence: number;
  /** 本次推論延遲（毫秒） */
  latencyMs: number;
  /** 哪個 provider 產出 — 用於監控與投票記錄 */
  provider: string;
  /** Provider 特定 metadata（如 raw response、artifacts、bbox …） */
  metadata: Record<string, unknown>;
}

/**
 * 所有 provider 必須實作的介面。
 */
export interface PlateRecognizer {
  readonly name: string;
  /** 在當前環境是否可用（API key 是否設定、模型是否載入等）。 */
  isEnabled(): boolean;
  /**
   * 辨識車牌。支援多張影像（cross-frame）。
   * 應**永不拋例外**——失敗包裝為 status=error 回傳，方便 dispatcher 容錯。
   */
  recognize(imagePaths: string[], vehicleTypeHint?: string): Promise<RecognitionResult>;
}

/**
 * 投票結果。
 */
export interface VoteResult {
  /** 最終共識（boost 後的 RecognitionResult） */
  consensus: RecognitionResult;
  /** 每個 provider 的原始投票 */
  votes: RecognitionResult[];
  /** 一致性等級 */
  agreement: "all" | "majority" | "split" | "single_provider" | "all_failed";
}
