import type { ComplianceCheck, ReportContext } from "../types.js";

const MIN_PHOTOS_FOR_CONTINUOUS_TRAFFIC = 2;
const MIN_INTERVAL_MINUTES = 3;

function continuousParkingTerms(description: string): boolean {
  return /(違停|併排|紅線|黃線|騎樓|人行道停車)/.test(description);
}

function intervalMinutes(a: Date | undefined, b: Date | undefined): number | undefined {
  if (!a || !b) return undefined;
  return Math.abs(a.getTime() - b.getTime()) / 60_000;
}

/**
 * Checks the report against Taiwan's reporting rules before sending.
 * Per 道交條例 §7-1: 民眾檢舉須具名；持續性違規（如違停）需間隔 3 分鐘以上、
 * 且包含可辨識車牌之兩張以上照片。
 */
export function checkCompliance(ctx: ReportContext): ComplianceCheck {
  const issues: string[] = [];

  if (!ctx.reporter) {
    issues.push("❗ 未設定檢舉人身分。道交條例 §7-1 規定須具名檢舉，匿名報案不受理。請先用 /identify 設定姓名與聯絡方式。");
  }

  if (
    ctx.analysis.category === "traffic" &&
    continuousParkingTerms(ctx.analysis.description)
  ) {
    if (ctx.evidence.length < MIN_PHOTOS_FOR_CONTINUOUS_TRAFFIC) {
      issues.push(
        `❗ 持續性違規（如違停）法定需 ${MIN_PHOTOS_FOR_CONTINUOUS_TRAFFIC} 張以上、間隔 ${MIN_INTERVAL_MINUTES} 分鐘之照片。目前僅 ${ctx.evidence.length} 張。請補拍後傳送照片群組（album）。`,
      );
    } else {
      const t0 = ctx.evidence[0]?.capturedAt;
      const tLast = ctx.evidence[ctx.evidence.length - 1]?.capturedAt;
      const gap = intervalMinutes(t0, tLast);
      if (gap === undefined) {
        issues.push(
          `⚠ 多張照片缺少 EXIF 時間戳記，無法證明違規持續 ${MIN_INTERVAL_MINUTES} 分鐘以上，可能被退案。`,
        );
      } else if (gap < MIN_INTERVAL_MINUTES) {
        issues.push(
          `❗ 照片時間間隔僅 ${gap.toFixed(1)} 分鐘，法定需 ≥ ${MIN_INTERVAL_MINUTES} 分鐘。`,
        );
      }
    }
  }

  if (!ctx.analysis.identifiers.licensePlate && ctx.analysis.category === "traffic") {
    issues.push("⚠ 未辨識出車牌；交通違規檢舉缺車牌時通常不受理。請補上更清晰之照片或用 /address 提供描述。");
  }

  if (ctx.address.full.startsWith("（未取得地址")) {
    issues.push("⚠ 尚未取得明確地址，請用 /address 補上完整地址。");
  }

  return { ok: issues.length === 0, issues };
}
