import { matchLegalCitationsMulti } from "../data/legal-rules.js";
import type { ComplianceCheck, LegalCitation, ReportContext } from "../types.js";
import { computeStatuteOfLimitations } from "./statute-of-limitations.js";

const MIN_PHOTOS_FOR_CONTINUOUS_TRAFFIC = 2;
const MIN_INTERVAL_MINUTES = 3;

function intervalMinutes(a: Date | undefined, b: Date | undefined): number | undefined {
  if (!a || !b) return undefined;
  return Math.abs(a.getTime() - b.getTime()) / 60_000;
}

/**
 * 從已比對之 citations 推導出本案最低採證要件：
 * - 任一條 instantaneous → 單張即可
 * - 否則若有 continuous → 需 ≥ 2 張 + ≥ 3 分鐘
 * - 否則若有 moving → 動態違規（需錄影／連續多張）
 * - 都沒有 → 預設 continuous（保守）
 */
function deriveEvidenceMode(
  citations: LegalCitation[],
): "instantaneous" | "continuous" | "moving" {
  if (citations.some((c) => c.evidenceMode === "instantaneous")) return "instantaneous";
  if (citations.some((c) => c.evidenceMode === "continuous")) return "continuous";
  if (citations.some((c) => c.evidenceMode === "moving")) return "moving";
  return "continuous";
}

/**
 * 檢查 §7-1 民眾檢舉適用性。
 * 若所有命中之法條皆 reportableByCitizen === false，視為不可檢舉。
 */
function checkCitizenReportable(citations: LegalCitation[]): {
  reportable: boolean;
  policeOnly: LegalCitation[];
} {
  const policeOnly = citations.filter((c) => c.reportableByCitizen === false);
  const reportable = citations.some((c) => c.reportableByCitizen !== false);
  return { reportable, policeOnly };
}

/**
 * Checks the report against Taiwan's reporting rules before sending.
 *
 * Per 道交條例 §7-1: 民眾檢舉須具名。
 *
 * 採證要件依違規類別自動判定（取自命中之 LegalCitation.evidenceMode）。
 *
 * Citations 可由呼叫端傳入；若未傳入則自行 lookup。
 */
export function checkCompliance(
  ctx: ReportContext,
  citations?: LegalCitation[],
): ComplianceCheck {
  const issues: string[] = [];
  const matchedCitations =
    citations ??
    matchLegalCitationsMulti(
      ctx.analysis.category,
      ctx.analysis.description,
      ctx.analysis.sceneType,
    );

  // 0) 場域豁免（派出所 / 軍營 / 公務車於指定處停放）
  if (
    ctx.analysis.sceneType === "private_property" ||
    ctx.analysis.vehicleType === "police" ||
    ctx.analysis.vehicleType === "government"
  ) {
    issues.push(
      "❗ 影像識別為**權威場域**（派出所 / 軍營 / 公務車於指定處），警車於執勤駐地停放屬合法（依道交 §90、§91 警勤車豁免規定）。本案不在 §7-1 民眾檢舉範圍。如對警員勤務有疑慮，請改循：110 / 1999 / 警察機關政風單位 / 監察院陳情。",
    );
  }

  // 0.5) EV 排氣豁免（電動車不可能排氣超標）
  if (
    (ctx.analysis.vehicleType === "ev_car" ||
      ctx.analysis.vehicleType === "ev_motorcycle" ||
      ctx.analysis.vehicleType === "rental_ev") &&
    /(排氣|黑煙|空污)/.test(ctx.analysis.description)
  ) {
    issues.push(
      "❗ 影像識別為**電動車**（無內燃機排氣管），不可能觸發空污法 §40 排氣超標。請檢視違規描述是否誤判。",
    );
  }

  // 1) 具名舉發
  if (!ctx.reporter) {
    issues.push(
      "❗ 未設定檢舉人身分。道交條例 §7-1 規定須具名檢舉，匿名報案不受理。請先用 /identify 設定姓名與聯絡方式。",
    );
  }

  // 2) §7-1 民眾檢舉適用性
  if (ctx.analysis.category === "traffic") {
    const { reportable, policeOnly } = checkCitizenReportable(matchedCitations);
    if (!reportable) {
      const labels = policeOnly.map((c) => c.shortLabel ?? c.article).join("、");
      issues.push(
        `❗ 此違規類型（${labels}）不在民眾檢舉適用範圍（道交 §7-1）。請改撥 110 由警員到場稽查，或保留證據至當地警察分局報案。`,
      );
    }
  }

  // 3) 採證要件
  if (ctx.analysis.category === "traffic") {
    const mode = deriveEvidenceMode(matchedCitations);

    if (mode === "continuous") {
      if (ctx.evidence.length < MIN_PHOTOS_FOR_CONTINUOUS_TRAFFIC) {
        issues.push(
          `❗ 黃線或一般違停舉發法定需 ${MIN_PHOTOS_FOR_CONTINUOUS_TRAFFIC} 張以上、間隔 ${MIN_INTERVAL_MINUTES} 分鐘之照片以證明非臨時停車。目前僅 ${ctx.evidence.length} 張。`,
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
    // moving 違規（闖紅燈、未禮讓行人、蛇行 …）：單張清晰照片可受理；
    // 實務上多以行車記錄器影片或連續多張為佳，但不在 compliance 強制範圍。
    // instantaneous → 不額外要求張數/間隔
  }

  // 4) 車牌（交通類）— 需存在 + 需經人工確認
  if (ctx.analysis.category === "traffic") {
    if (!ctx.analysis.identifiers.licensePlate) {
      issues.push(
        "⚠ 未辨識出車牌；交通違規檢舉缺車牌時通常不受理。請補拍更清晰之車牌特寫，或用 /plate <車牌> 手動輸入。",
      );
    } else if (ctx.plateRequiresVerification && !ctx.plateConfirmed) {
      issues.push(
        `❗ 車牌「${ctx.analysis.identifiers.licensePlate}」需經您人工核可後始可送件。LPR 引擎報告信心不足或影像有瑕疵（距離/角度/解析度），請用 /plate <車牌> 確認或修正。`,
      );
    }
  }

  // 5) 地址
  if (ctx.address.full.startsWith("（未取得地址")) {
    issues.push("⚠ 尚未取得明確地址，請用 /address 補上完整地址。");
  }

  // 6) 舉發時效（道交 §90）
  const capturedAt = ctx.evidence[0]?.capturedAt;
  if (capturedAt) {
    const sol = computeStatuteOfLimitations(ctx.analysis.category, capturedAt);
    if (!sol.valid) {
      issues.push(
        `❗ 已逾舉發時效（${sol.basis}）。拍攝至今 ${Math.abs(sol.remainingDays)} 天，已超過 ${sol.totalDays} 天上限。即使送件機關亦不予舉發。`,
      );
    } else if (sol.totalDays > 0 && sol.remainingDays <= 7) {
      issues.push(
        `⚠ 距舉發時效屆滿剩 ${sol.remainingDays} 天（${sol.basis}）。請儘速完成送件。`,
      );
    }
  } else if (ctx.analysis.category === "traffic") {
    issues.push(
      "⚠ 拍攝時間（EXIF）未取得。道交 §90 三個月舉發時效自違規日起算，建議於原檔或書面註記實際拍攝時間。",
    );
  }

  // 7) 刑罰優先（行政罰法 §26）
  for (const c of matchedCitations) {
    if (c.criminalAlternative) {
      issues.push(
        `⚠ 本案類型可能同時觸犯刑事罪（${c.criminalAlternative.statute} ${c.criminalAlternative.article}：${c.criminalAlternative.description}）。依《行政罰法 §26》一事不二罰原則，刑罰優先。${c.criminalAlternative.preferredAction}`,
      );
    }
  }

  return { ok: issues.length === 0, issues };
}
