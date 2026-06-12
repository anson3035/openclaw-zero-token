/**
 * 車牌交叉驗證 — 把 LPR 認出的車牌跟車籍資料對照，
 * 抓出 OCR 看錯 1 個字（B↔8、O↔Q、N↔M、I↔1）的常見失誤。
 *
 * 流程：
 *   1. 直查 LPR 認出的車牌
 *   2. 若 not_found，產生「鄰近候選」字串（B↔8 等替換）並依次查詢
 *   3. 若候選命中且 vehicleType 一致，標記 mismatch + 建議改用候選
 *   4. 若直查命中，做 vehicleType 一致性比對；矛盾則標記 warning
 *
 * 整合 LPR pipeline：對 enrichPlateWithLpr 的結果做後處理，可降低
 * trustworthy 標誌或建議使用者重新確認。
 */

import type { VehicleType } from "../types.js";
import {
  canonicalPlate,
  getRegistryProvider,
  vehicleTypeConsistency,
  type VehicleRegistryEntry,
} from "./vehicle-registry.js";

export interface CrossCheckResult {
  /** LPR 直接認出的車牌（canonical）。*/
  lprPlate: string;
  /** 直查 / 候選比對後系統建議使用的車牌。 */
  suggestedPlate: string;
  /** lprPlate === suggestedPlate */
  plateMatch: boolean;
  /** 命中之車籍（若有）。 */
  registryEntry?: VehicleRegistryEntry;
  /** vehicleType 一致性。 */
  vehicleTypeMatch: "consistent" | "mismatched" | "unknown";
  /** 此次比對是否完全可信（lprPlate=registry plate 且 vehicleType=consistent）。 */
  trustworthy: boolean;
  /** OCR 鄰近候選清單（僅含實際查得車籍者）。 */
  candidates: Array<{ plate: string; entry: VehicleRegistryEntry }>;
  /** 人類可讀說明。 */
  notes: string[];
}

/**
 * 對 OCR 易混淆字元做 1-bit 替換產生候選字串。
 *
 * 字元混淆對照（雙向）：
 *   8 ↔ B   0 ↔ O ↔ Q ↔ D   1 ↔ I ↔ L
 *   5 ↔ S   2 ↔ Z   6 ↔ G ↔ C
 *   N ↔ M ↔ H   U ↔ V   E ↔ F
 */
const SUBS: Record<string, readonly string[]> = {
  // 6 ↔ 8 圓形相似（低解析度時常見混淆）；6 ↔ 0、8 ↔ 0 亦類似
  "8": ["B", "6", "0"],
  "6": ["G", "C", "8", "0"],
  "0": ["O", "Q", "D", "8", "6"],
  B: ["8"],
  O: ["0", "Q", "D"], // MOTC 不發 'O'，純為候選輸入
  Q: ["0", "O"],
  D: ["0", "O"],
  "1": ["I", "L", "7"],
  "7": ["1", "T"],
  T: ["7"],
  I: ["1", "L"], // MOTC 不發 'I'
  L: ["1", "I"],
  "5": ["S"],
  S: ["5"],
  "2": ["Z"],
  Z: ["2"],
  G: ["6"],
  C: ["6", "G"],
  N: ["M", "H"],
  M: ["N", "H"],
  H: ["N", "M"],
  U: ["V"],
  V: ["U"],
  E: ["F"],
  F: ["E"],
};

/**
 * 產生 OCR 鄰近候選車牌。
 *
 * @param plate         主車牌字串（任意格式，函式內 canonicalize）
 * @param maxCandidates 候選總數上限（包含一字與二字替換）
 * @param depth         單一車牌可替換之字元數上限：
 *                       1 = 只改一字（B↔8 / N↔M ...）
 *                       2 = 同時改二字（如 672-JFM → 872-JFN 兩字 OCR 同時看錯）
 */
export function generateOcrCandidates(
  plate: string,
  maxCandidates = 60,
  depth = 2,
): string[] {
  const canonical = canonicalPlate(plate);
  const stripped = canonical.replace(/-/g, "");
  const seen = new Set<string>();

  // 一字替換（單字位置）
  const oneStep: string[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]!;
    const subs = SUBS[ch];
    if (!subs) continue;
    for (const sub of subs) {
      const candidate =
        stripped.substring(0, i) + sub + stripped.substring(i + 1);
      const norm = canonicalPlate(candidate);
      if (norm !== canonical && !seen.has(norm)) {
        seen.add(norm);
        oneStep.push(candidate);
        if (seen.size >= maxCandidates) return [...seen];
      }
    }
  }

  if (depth < 2) return [...seen];

  // 二字替換（任意兩個不同位置）— 在一字替換結果上再套一次替換
  for (const stage1 of oneStep) {
    for (let i = 0; i < stage1.length; i++) {
      const ch = stage1[i]!;
      const subs = SUBS[ch];
      if (!subs) continue;
      for (const sub of subs) {
        const cand = stage1.substring(0, i) + sub + stage1.substring(i + 1);
        const norm = canonicalPlate(cand);
        if (norm !== canonical && !seen.has(norm)) {
          seen.add(norm);
          if (seen.size >= maxCandidates) return [...seen];
        }
      }
    }
  }
  return [...seen];
}

export interface CrossCheckOptions {
  /** Enable OCR-confusable candidate fallback when direct lookup fails. */
  enableFallbackCandidates?: boolean;
  /** Hard cap on candidate plates to query (each is 1 HTTP round-trip). */
  maxCandidates?: number;
  /** vision 模型回報之 vehicleType，作 displacement 一致性比對用。 */
  vehicleType?: VehicleType;
}

export async function crossCheckPlate(
  lprPlate: string,
  opts: CrossCheckOptions = {},
): Promise<CrossCheckResult> {
  const provider = getRegistryProvider();
  const canonical = canonicalPlate(lprPlate);
  const notes: string[] = [];

  // 1) 直查
  const direct = await provider.lookup(canonical);
  if (direct.status === "found") {
    const consistency = vehicleTypeConsistency(opts.vehicleType, direct.entry);
    if (consistency === "mismatched") {
      notes.push(
        `⚠ 車籍資料顯示 ${direct.entry.make}（${direct.entry.displacementCc}cc${direct.entry.strokeType ? ` / ${direct.entry.strokeType}` : ""}），與影像識別之 vehicleType=${opts.vehicleType} 不符。`,
      );
    } else if (consistency === "consistent") {
      notes.push(
        `✅ 車籍核對：${direct.entry.make} ${direct.entry.displacementCc}cc${direct.entry.strokeType ? ` ${direct.entry.strokeType}` : ""}，與影像識別一致。`,
      );
    }
    return {
      lprPlate: canonical,
      suggestedPlate: canonical,
      plateMatch: true,
      registryEntry: direct.entry,
      vehicleTypeMatch: consistency,
      trustworthy: consistency !== "mismatched",
      candidates: [],
      notes,
    };
  }
  if (direct.status === "error") {
    notes.push(`⚠ 車籍查詢失敗：${direct.reason}（已略過自動交叉驗證）`);
    return {
      lprPlate: canonical,
      suggestedPlate: canonical,
      plateMatch: true,
      vehicleTypeMatch: "unknown",
      trustworthy: false, // 查不到不代表錯，但也無法確認 — 不可信任
      candidates: [],
      notes,
    };
  }
  // status === "not_found"
  notes.push(`⚠ 車籍資料庫查無 ${canonical}（可能 OCR 看錯一字，或車輛已報廢）。`);

  if (!(opts.enableFallbackCandidates ?? true)) {
    return {
      lprPlate: canonical,
      suggestedPlate: canonical,
      plateMatch: true,
      vehicleTypeMatch: "unknown",
      trustworthy: false,
      candidates: [],
      notes,
    };
  }

  // 2) 鄰近候選掃描
  const candidates = generateOcrCandidates(canonical, opts.maxCandidates ?? 30);
  const hits: Array<{ plate: string; entry: VehicleRegistryEntry }> = [];
  for (const c of candidates) {
    const r = await provider.lookup(c);
    if (r.status === "found") {
      hits.push({ plate: c, entry: r.entry });
    }
  }

  if (hits.length === 0) {
    notes.push(
      `🔎 已嘗試 ${candidates.length} 組 OCR 鄰近候選，均查無車籍。請手動以 /plate 修正車牌或補充行車紀錄器影像。`,
    );
    return {
      lprPlate: canonical,
      suggestedPlate: canonical,
      plateMatch: true,
      vehicleTypeMatch: "unknown",
      trustworthy: false,
      candidates: [],
      notes,
    };
  }

  // 偏好 vehicleType 一致的候選；若同時多個，挑最近 registrationDate
  let best = hits[0]!;
  for (const h of hits) {
    const cur = vehicleTypeConsistency(opts.vehicleType, h.entry);
    const prev = vehicleTypeConsistency(opts.vehicleType, best.entry);
    if (cur === "consistent" && prev !== "consistent") {
      best = h;
    }
  }
  const consistency = vehicleTypeConsistency(opts.vehicleType, best.entry);
  notes.push(
    `💡 OCR 候選命中：${best.plate}（${best.entry.make} ${best.entry.displacementCc}cc${best.entry.strokeType ? ` / ${best.entry.strokeType}` : ""}）— 建議改用此車牌。`,
  );
  if (hits.length > 1) {
    notes.push(
      `⚠ 另外尚有 ${hits.length - 1} 個 OCR 候選同時在車籍命中（${hits
        .filter((h) => h.plate !== best.plate)
        .map((h) => h.plate)
        .join("、")}），請以行車紀錄器、更多照片或現場資訊確認，避免誤檢舉。`,
    );
  }
  return {
    lprPlate: canonical,
    suggestedPlate: best.plate,
    plateMatch: false,
    registryEntry: best.entry,
    vehicleTypeMatch: consistency,
    trustworthy: false, // 改字了，必須使用者確認
    candidates: hits,
    notes,
  };
}
