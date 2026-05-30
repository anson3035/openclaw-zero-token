/**
 * 舉發時效檢查（道路交通管理處罰條例 §90 第 1 項）。
 *
 * 法源：
 *   道交條例 §90 第 1 項
 *   「違反本條例之行為，自行為成立之日起，逾三個月不得舉發。」
 *
 * 環保類違規時效：
 *   廢棄物清理法、空污法、噪音管制法多適用 3 年裁罰時效（行政罰法 §27）。
 *   但檢舉時效仍宜把握 1 年內。
 *
 * 建築類違規：
 *   建築法違規多無檢舉時效限制（持續違規狀態）。
 */
import type { ViolationCategory } from "../types.js";

const SOL_DAYS: Record<ViolationCategory, number> = {
  traffic: 90, // 道交條例 §90 第 1 項
  environment: 365, // 約一年，實際依各專法時效
  building: 0, // 違章建築狀態持續，無檢舉時效
  condominium: 0, // 同上
};

export interface SolStatus {
  /** 違規類型 */
  category: ViolationCategory;
  /** 時效天數（0 = 無時效限制） */
  totalDays: number;
  /** 距時效屆滿剩餘天數（負值 = 已過期） */
  remainingDays: number;
  /** 是否仍在時效內 */
  valid: boolean;
  /** 法源說明 */
  basis: string;
}

export function computeStatuteOfLimitations(
  category: ViolationCategory,
  violationDate: Date,
  now: Date = new Date(),
): SolStatus {
  const totalDays = SOL_DAYS[category];
  const basis =
    category === "traffic"
      ? "道路交通管理處罰條例 §90 第 1 項：自行為成立之日起，逾三個月不得舉發。"
      : category === "environment"
        ? "依各環保專法（廢清法 / 空污法 / 噪音法）裁罰時效辦理，建議 1 年內檢舉。"
        : "建築 / 公寓大廈類違規多屬持續違規狀態，無檢舉時效限制。";

  if (totalDays === 0) {
    return { category, totalDays: 0, remainingDays: Infinity, valid: true, basis };
  }

  const deadline = new Date(violationDate);
  deadline.setDate(deadline.getDate() + totalDays);
  const ms = deadline.getTime() - now.getTime();
  const remaining = Math.ceil(ms / (1000 * 60 * 60 * 24));

  return {
    category,
    totalDays,
    remainingDays: remaining,
    valid: remaining > 0,
    basis,
  };
}
