/**
 * 跨 provider 智慧調度器（落地版）。
 *
 * 與 Python skeleton 同樣的 SmartDispatcher 模式，但在 TS 端針對車牌辨識
 * 做了專門化：
 *   • 註冊 N 個 provider（OpenAI / Gemini / 未來可加 Claude、Qwen-VL …）
 *   • dispatch() — 單 provider（最快路徑）
 *   • voteDispatch() — 跨 provider 投票，獨立 verification → 真正信心提升
 *
 * 投票邏輯：
 *   1. 並行呼叫所有 enabled providers
 *   2. 過濾掉 error / empty 結果
 *   3. 按 plate text 分組，找出最大群（majority）
 *   4. 一致性分級：
 *        all       — 所有有效投票一致
 *        majority  — 過半一致
 *        split     — 沒有過半
 *   5. Confidence boost 比例：
 *        all       × 1.30 (capped 0.99)
 *        majority  × 1.15
 *        split     × 0.70  ← 互相不認，等同 strong negative signal
 */
import type { PlateRecognizer, RecognitionResult, VoteResult } from "./types.js";

const VOTE_BOOST = {
  all: 1.3,
  majority: 1.15,
  split: 0.7,
} as const;

export class RecognitionDispatcher {
  private readonly recognizers: PlateRecognizer[] = [];

  /** Fluent API：register OpenAI、Gemini …。回傳 this 以支援鏈式呼叫。 */
  register(recognizer: PlateRecognizer): this {
    this.recognizers.push(recognizer);
    return this;
  }

  /** 當前環境可用的 provider（API key 有設定等）。 */
  enabledRecognizers(): PlateRecognizer[] {
    return this.recognizers.filter((r) => r.isEnabled());
  }

  /** 單 provider 推論（取第一個 enabled）。最快路徑。 */
  async dispatch(imagePaths: string[], vehicleTypeHint?: string): Promise<RecognitionResult> {
    const enabled = this.enabledRecognizers();
    if (enabled.length === 0) {
      return {
        status: "error",
        text: "",
        confidence: 0,
        latencyMs: 0,
        provider: "none",
        metadata: { error: "No recognizer is enabled (no API keys set)" },
      };
    }
    return enabled[0]!.recognize(imagePaths, vehicleTypeHint);
  }

  /**
   * 跨引擎投票：並行呼叫所有可用 providers，依一致性 boost / penalty 信心。
   *
   * 當只有一個 provider enabled 時，degenerates 為單 provider 呼叫。
   */
  async voteDispatch(
    imagePaths: string[],
    vehicleTypeHint?: string,
  ): Promise<VoteResult> {
    const enabled = this.enabledRecognizers();

    if (enabled.length === 0) {
      return {
        consensus: {
          status: "error",
          text: "",
          confidence: 0,
          latencyMs: 0,
          provider: "none",
          metadata: { error: "No recognizer enabled" },
        },
        votes: [],
        agreement: "all_failed",
      };
    }

    if (enabled.length === 1) {
      const single = await enabled[0]!.recognize(imagePaths, vehicleTypeHint);
      return { consensus: single, votes: [single], agreement: "single_provider" };
    }

    // 並行呼叫
    const votes = await Promise.all(
      enabled.map((r) => r.recognize(imagePaths, vehicleTypeHint)),
    );

    // 排除錯誤與空字串
    const validVotes = votes.filter((v) => v.status !== "error" && v.text.length > 0);
    if (validVotes.length === 0) {
      const best = votes[0]!;
      return {
        consensus: best,
        votes,
        agreement: "all_failed",
      };
    }

    // 按 plate text 分組
    const groups = new Map<string, RecognitionResult[]>();
    for (const v of validVotes) {
      const key = normalizePlate(v.text);
      const g = groups.get(key) ?? [];
      g.push(v);
      groups.set(key, g);
    }

    // 找最大群
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    const [winningKey, winningVotes] = sorted[0]!;

    let agreement: VoteResult["agreement"];
    if (winningVotes.length === validVotes.length) agreement = "all";
    else if (winningVotes.length > validVotes.length / 2) agreement = "majority";
    else agreement = "split";

    // 選最高信心者作為 consensus，套用 boost
    const best = winningVotes.reduce((acc, v) => (v.confidence > acc.confidence ? v : acc));
    const boost = VOTE_BOOST[agreement];
    const finalConf = Math.max(0, Math.min(0.99, best.confidence * boost));

    const consensus: RecognitionResult = {
      ...best,
      confidence: finalConf,
      status: finalConf >= 0.85 ? "success" : "low_confidence",
      metadata: {
        ...best.metadata,
        vote_agreement: agreement,
        vote_winning_text: winningKey,
        vote_winning_count: winningVotes.length,
        vote_total_count: validVotes.length,
        vote_boost_factor: boost,
        vote_all_providers: votes.map((v) => ({
          provider: v.provider,
          text: v.text,
          confidence: v.confidence,
          status: v.status,
          latencyMs: v.latencyMs,
        })),
      },
    };

    return { consensus, votes, agreement };
  }
}

/** 標準化 plate 以便分組比對：去掉空白、轉大寫、去掉可能的「-」差異。 */
function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/\s+/g, "").replace(/[-·．。]/g, "-");
}
