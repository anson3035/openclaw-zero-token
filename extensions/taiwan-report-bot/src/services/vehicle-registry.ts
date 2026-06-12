/**
 * 車籍資料查詢 — 透過環境部行動版排氣定檢公開查詢頁
 *   https://mobile.moenv.gov.tw/  （查詢「機車排氣定檢結果」即顯示車籍）
 *
 * 此頁無需登入、無 captcha，回傳：
 *   - 車牌號碼 / 廠牌 / 排氣量 / 行程別 / 出廠日 / 發照日
 *   - 最近一次排氣定檢結果（合格 / 不合格 / 應檢未檢）
 *
 * 用於：
 *   1. **車牌交叉驗證**：LPR 認 ABC-1234 若 registry 查無 → flag low confidence
 *   2. **vehicleType 一致性檢查**：vision 認「機車輕型」若 registry 排氣量 250cc 以上 → 矛盾
 *   3. **排氣不合格自動命中**：環保署檢測「不合格 / 應檢未檢」可直接觸發環保條文
 *
 * 設計：provider interface 抽象，預設用 MOENV mobile HTTP 端點，
 *      測試用 in-memory mock 注入。
 *
 * 注意：實際 endpoint 由前端 SPA 呼叫，可能變動；本檔以 documented stub
 *      實作 default provider，整合時請以實際 endpoint 修正。
 */

import type { VehicleType } from "../types.js";

export interface VehicleRegistryEntry {
  /** Plate as canonicalized by registry (含分隔符 "ABC-1234"). */
  plate: string;
  /** 廠牌 — 中文（例：光陽、山葉、Toyota）。*/
  make: string;
  /** 排氣量 cc（汽車也以排氣量表示）。EV 為 0。 */
  displacementCc: number;
  /** 行程別（"四行程" / "二行程" / "電動"）。*/
  strokeType?: "四行程" | "二行程" | "電動" | "其他";
  /** 出廠日（YYYYMMDD）。*/
  manufactureDate?: string;
  /** 發照日（YYYYMMDD）— 首次領牌日。*/
  registrationDate?: string;
  /** 最近一次排氣檢測。*/
  latestEmissionTest?: {
    /** "合格" / "不合格" / "應檢未檢"。 */
    result: "合格" | "不合格" | "應檢未檢" | "未檢測";
    date?: string;
    hcPpm?: number;
    coPercent?: number;
    co2Percent?: number;
  };
}

export type RegistryLookupResult =
  | { status: "found"; entry: VehicleRegistryEntry }
  | { status: "not_found"; plate: string }
  | { status: "error"; plate: string; reason: string };

export interface VehicleRegistryProvider {
  /** Implementation must canonicalize/normalize the input plate. */
  lookup(plate: string): Promise<RegistryLookupResult>;
}

// ────────────────────────────────────────────────────────────────────
// In-memory mock provider — for tests + offline mode.
// ────────────────────────────────────────────────────────────────────
export class InMemoryRegistryProvider implements VehicleRegistryProvider {
  private map = new Map<string, VehicleRegistryEntry>();

  set(entry: VehicleRegistryEntry): void {
    this.map.set(canonicalPlate(entry.plate), entry);
  }

  clear(): void {
    this.map.clear();
  }

  async lookup(plate: string): Promise<RegistryLookupResult> {
    const key = canonicalPlate(plate);
    const e = this.map.get(key);
    if (e) return { status: "found", entry: e };
    return { status: "not_found", plate: key };
  }
}

// ────────────────────────────────────────────────────────────────────
// HTTP provider — environs.moenv.gov.tw mobile.
// ────────────────────────────────────────────────────────────────────
/**
 * 預設 MOENV 行動版端點。實際路徑可能異動；以下為 best-effort 推測，
 * 整合測試時請以 production endpoint 驗證並更新。
 *
 * 行為：
 *   1. POST/GET 帶 plate 取回 HTML 或 JSON 片段
 *   2. 解析「車牌號碼 / 廠牌 / 排氣量 / 行程別 / 出廠日 / 發照日」
 *   3. 解析最近一次排氣定檢欄位（HC / CO / CO2 / 檢測結果 / 檢測日期）
 */
export class MoenvHttpRegistryProvider implements VehicleRegistryProvider {
  constructor(
    private readonly endpoint: string = "https://mobile.moenv.gov.tw/aedem-mobile/api/vehicle/lookup",
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly timeoutMs: number = 5000,
  ) {}

  async lookup(plate: string): Promise<RegistryLookupResult> {
    const key = canonicalPlate(plate);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const url = `${this.endpoint}?plate=${encodeURIComponent(key)}`;
      const res = await this.fetchImpl(url, {
        signal: ctl.signal,
        headers: { Accept: "application/json,text/html" },
      });
      if (res.status === 404) return { status: "not_found", plate: key };
      if (!res.ok) {
        return { status: "error", plate: key, reason: `HTTP ${res.status}` };
      }
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const json = (await res.json()) as Partial<VehicleRegistryEntry> & {
          plate?: string;
        };
        if (!json.make || !json.displacementCc) {
          return { status: "not_found", plate: key };
        }
        return {
          status: "found",
          entry: {
            plate: json.plate ?? key,
            make: json.make,
            displacementCc: json.displacementCc,
            strokeType: json.strokeType,
            manufactureDate: json.manufactureDate,
            registrationDate: json.registrationDate,
            latestEmissionTest: json.latestEmissionTest,
          },
        };
      }
      const html = await res.text();
      const entry = parseMoenvHtml(html, key);
      if (!entry) return { status: "not_found", plate: key };
      return { status: "found", entry };
    } catch (err) {
      return {
        status: "error",
        plate: key,
        reason: (err as Error).message ?? "fetch failed",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/** Canonicalize: uppercase + 統一 dash. 接受 "abc1234", "ABC-1234", "abc 1234". */
export function canonicalPlate(raw: string): string {
  const stripped = raw.toUpperCase().replace(/[\s\-‐‑‒–—]/g, "");
  // 還原 dash 分隔（最常見格式 ABC-1234 或 1234-AB）
  // 規則：尾 4 碼為數字 → 在尾 4 之前插 "-"；尾 2 為字母 → 在尾 2 前插 "-"
  if (/^[A-Z0-9]{6,8}$/.test(stripped)) {
    if (/^[A-Z]{2,4}\d{2,4}$/.test(stripped)) {
      const m = stripped.match(/^([A-Z]+)(\d+)$/);
      if (m) return `${m[1]}-${m[2]}`;
    }
    if (/^\d{2,4}[A-Z]{2,4}$/.test(stripped)) {
      const m = stripped.match(/^(\d+)([A-Z]+)$/);
      if (m) return `${m[1]}-${m[2]}`;
    }
    // 機車 3 字+3 數 / 3 數+3 字
    if (/^[A-Z]{3}\d{3,4}$/.test(stripped)) {
      const m = stripped.match(/^([A-Z]{3})(\d+)$/);
      if (m) return `${m[1]}-${m[2]}`;
    }
    if (/^\d{3}[A-Z]{3}$/.test(stripped)) {
      const m = stripped.match(/^(\d{3})([A-Z]{3})$/);
      if (m) return `${m[1]}-${m[2]}`;
    }
  }
  return stripped;
}

/**
 * 從環境部行動版 HTML 解析車籍區塊。寬鬆比對「車牌號碼 / 廠牌 / 排氣量」等
 * label 後緊跟的 td/span 內容。
 */
export function parseMoenvHtml(html: string, plateKey: string): VehicleRegistryEntry | undefined {
  const grab = (label: string): string | undefined => {
    // 抓「label ...任意 tag(s)... value」結構：
    //   <td>車牌號碼</td><td>672-JFM</td>
    //   <th>廠牌</th><td>光陽</td>
    //   <dt>排氣量</dt><dd>111</dd>
    // 允許 label 與 value 之間有 1+ 個 HTML tag。
    const re = new RegExp(
      `${label}\\s*(?:<[^>]+>\\s*)+([^<\\s][^<]*?)\\s*<`,
      "i",
    );
    const m = re.exec(html);
    return m?.[1]?.trim();
  };
  const plate = grab("車牌號碼") ?? plateKey;
  const make = grab("廠牌");
  const ccStr = grab("排氣量");
  const stroke = grab("行程別");
  const manuf = grab("出廠日");
  const reg = grab("發照日");
  const result = grab("檢測結果");
  const date = grab("檢測日期");

  if (!make || !ccStr) return undefined;
  const cc = Number.parseInt(ccStr.replace(/[^0-9]/g, ""), 10);
  if (!Number.isFinite(cc)) return undefined;

  const validStroke: VehicleRegistryEntry["strokeType"] =
    stroke === "四行程" || stroke === "二行程" || stroke === "電動"
      ? stroke
      : stroke
        ? "其他"
        : undefined;

  const validResult: NonNullable<VehicleRegistryEntry["latestEmissionTest"]>["result"] =
    result === "合格" || result === "不合格" || result === "應檢未檢"
      ? result
      : "未檢測";

  return {
    plate,
    make,
    displacementCc: cc,
    strokeType: validStroke,
    manufactureDate: manuf?.replace(/[^\d]/g, "") || undefined,
    registrationDate: reg?.replace(/[^\d]/g, "") || undefined,
    latestEmissionTest:
      result || date
        ? {
            result: validResult,
            date: date?.replace(/[^\d]/g, "") || undefined,
          }
        : undefined,
  };
}

// ────────────────────────────────────────────────────────────────────
// Singleton provider — overridable for tests/integration.
// ────────────────────────────────────────────────────────────────────
let providerSingleton: VehicleRegistryProvider | undefined;

export function setRegistryProvider(p: VehicleRegistryProvider): void {
  providerSingleton = p;
}

export function getRegistryProvider(): VehicleRegistryProvider {
  if (!providerSingleton) providerSingleton = new MoenvHttpRegistryProvider();
  return providerSingleton;
}

export function resetRegistryProviderForTests(): void {
  providerSingleton = undefined;
}

export async function lookupVehicleByPlate(plate: string): Promise<RegistryLookupResult> {
  return getRegistryProvider().lookup(plate);
}

// ────────────────────────────────────────────────────────────────────
// vehicleType 一致性比對
// ────────────────────────────────────────────────────────────────────

/**
 * 將 vision 模型回報的 vehicleType 與車籍排氣量比對。
 * 例：vision 報 motorcycle_light（≤ 250cc），registry 排氣量 111cc → consistent
 *     vision 報 motorcycle_heavy（> 250cc），registry 排氣量 111cc → mismatch
 *     vision 報 car，registry 排氣量 ≥ 600 且 strokeType !== "二行程" → consistent
 */
export function vehicleTypeConsistency(
  visionType: VehicleType | undefined,
  entry: VehicleRegistryEntry,
): "consistent" | "mismatched" | "unknown" {
  if (!visionType || visionType === "unknown") return "unknown";
  const cc = entry.displacementCc;
  const isEv = entry.strokeType === "電動" || cc === 0;
  const isLightMc = cc > 0 && cc <= 250;
  const isHeavyMc = cc > 250 && cc <= 1500 && /機|重機|YAMAHA|KAWASAKI|HONDA|SUZUKI|HARLEY|DUCATI|KYMCO|光陽|山葉/i.test(entry.make);
  const isCar = cc >= 600 && !isHeavyMc;

  switch (visionType) {
    case "ev_car":
    case "ev_motorcycle":
    case "rental_ev":
      return isEv ? "consistent" : "mismatched";
    case "motorcycle_light":
      return isLightMc ? "consistent" : "mismatched";
    case "motorcycle_heavy":
      return isHeavyMc ? "consistent" : "mismatched";
    case "car":
    case "suv":
    case "taxi":
    case "government":
    case "police":
      return isCar ? "consistent" : "mismatched";
    case "truck":
    case "bus":
      return cc >= 1500 ? "consistent" : "mismatched";
    default:
      return "unknown";
  }
}
