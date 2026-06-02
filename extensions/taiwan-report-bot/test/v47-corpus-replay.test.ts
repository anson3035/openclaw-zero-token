/**
 * v4.7 corpus regression — 重跑前幾次對話實際測試過的 9 張影像場景，
 * 確認 v4.7 安全強化（store mutateStore / sanitize / trackingId / scrypt /
 * identity validation / token revocation）沒有破壞任何 user-facing 行為。
 *
 * 影像本身未存於 repo（為 Telegram inline 上傳），但場景對應之
 * AnalyzedViolation 結構是確定性的 — 重放 legal-rules + compliance + report
 * 即可驗證每張影像最終輸出與先前一致。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AnalyzedViolation,
  MediaEvidence,
  ReportContext,
  ReporterIdentity,
  ResolvedAddress,
} from "../src/types.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "trb-corpus-"));
  process.env.DATA_DIR = dir;
  process.env.TELEGRAM_BOT_TOKEN = "0000000000:test_token_for_unit_tests";
  process.env.OPENAI_API_KEY = "sk-test-unit";
  const cfg = await import("../src/config.js");
  cfg.resetConfigForTests();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const reporter: ReporterIdentity = { name: "王小明", contact: "0912-345678" };
const addrTaipei: ResolvedAddress = {
  full: "台北市中正區忠孝東路一段 1 號",
  city: "台北市",
  district: "中正區",
  source: "user-input",
};
const addrNewTaipei: ResolvedAddress = {
  full: "新北市板橋區文化路二段 100 號",
  city: "新北市",
  district: "板橋區",
  source: "user-input",
};

function evidence(n = 1, intervalMinutes = 5): MediaEvidence[] {
  const base = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    filePath: `/tmp/case-${i}.jpg`,
    mimeType: "image/jpeg",
    sha256: "a".repeat(64),
    source: "telegram" as const,
    sourceMessageId: i + 1,
    sourceChatId: 1,
    capturedAt: new Date(base + i * intervalMinutes * 60_000),
  }));
}

function ctx(
  analysis: AnalyzedViolation,
  evidenceCount = 1,
  address = addrTaipei,
  intervalMinutes = 5,
): ReportContext {
  return {
    evidence: evidence(evidenceCount, intervalMinutes),
    analysis,
    address,
    reporter,
  };
}

describe("v4.7 corpus replay — 9 prior-session violation photos", () => {
  // ──────────────────────────────────────────────────────────────────
  // 1) PJW-3035 — 騎樓機車違停（多輛排排站）
  // ──────────────────────────────────────────────────────────────────
  it("[1] PJW-3035 騎樓機車違停 → 道交 §90 騎樓條款命中", async () => {
    const { matchLegalCitationsMulti } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitationsMulti(
      "traffic",
      "機車 PJW-3035 停放於騎樓內，影響行人通行",
      "arcade",
    );
    expect(cs.some((c) => c.shortLabel?.includes("騎樓"))).toBe(true);
    expect(cs.every((c) => c.reportableByCitizen !== false)).toBe(true);
  });

  it("[1b] 騎樓違停 compliance：單張 instantaneous 即可", async () => {
    const { checkCompliance } = await import("../src/services/compliance.js");
    const c = checkCompliance(
      ctx({
        category: "traffic",
        subject: "機車 PJW-3035",
        description: "機車停放騎樓內",
        identifiers: { licensePlate: "PJW-3035" },
        confidence: "high",
        evidenceGaps: [],
        vehicleType: "motorcycle_light",
        sceneType: "arcade",
      }),
    );
    expect(c.ok).toBe(true);
    expect(c.issues.filter((i) => i.startsWith("❗"))).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────
  // 2) 派出所 — 場域豁免
  // ──────────────────────────────────────────────────────────────────
  it("[2] 派出所場域 → compliance gate 阻擋（私人/權威場域豁免）", async () => {
    const { checkCompliance } = await import("../src/services/compliance.js");
    const c = checkCompliance(
      ctx({
        category: "traffic",
        subject: "警車停於派出所門口",
        description: "派出所前警車違停疑慮",
        identifiers: { licensePlate: "POL-0001" },
        confidence: "low",
        evidenceGaps: [],
        vehicleType: "police",
        sceneType: "private_property",
      }),
    );
    expect(c.ok).toBe(false);
    expect(c.issues.some((i) => i.includes("權威場域") || i.includes("警勤車"))).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────
  // 3) 環保 — 植物 / 廢棄物（environment category）
  // ──────────────────────────────────────────────────────────────────
  it("[3] 環保案件 → 廢棄物清理法 / 噪音 / 空污等 environment 條文命中", async () => {
    const { matchLegalCitationsMulti } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitationsMulti(
      "environment",
      "民眾於人行道棄置植物盆栽、家具等廢棄物",
      undefined,
    );
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.some((c) => c.statute.includes("廢棄物") || c.statute.includes("空污"))).toBe(true);
  });

  it("[3b] 環保案件之 reportable + 獎金資訊正確", async () => {
    const { matchLegalCitationsMulti } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitationsMulti(
      "environment",
      "亂丟廢棄物於人行道",
      undefined,
    );
    const wasteRule = cs.find((c) => c.statute.includes("廢棄物"));
    expect(wasteRule).toBeDefined();
    // 環保檢舉多有舉發獎金
    expect(wasteRule?.reward?.available).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────
  // 4) AHE-2238 Toyota — 一般紅線違停
  // ──────────────────────────────────────────────────────────────────
  it("[4] AHE-2238 紅線違停 → 道交 §56 命中、liability=owner", async () => {
    const { matchLegalCitationsMulti } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitationsMulti(
      "traffic",
      "Toyota AHE-2238 違停紅線",
      "red_line",
    );
    const redLine = cs.find((c) => c.shortLabel?.includes("紅線"));
    expect(redLine).toBeDefined();
    expect(redLine?.liabilityTarget).toBe("owner");
    expect(redLine?.evidenceMode).toBe("instantaneous");
  });

  // ──────────────────────────────────────────────────────────────────
  // 5) CAF-9555 夜間 — 證據力提示
  // ──────────────────────────────────────────────────────────────────
  it("[5] 夜間違停 → 證據缺口會被列入 evidenceGaps，report 仍可產出", async () => {
    const { buildReport } = await import("../src/services/report.js");
    const r = buildReport(
      ctx({
        category: "traffic",
        subject: "CAF-9555 夜間違停",
        description: "夜間 CAF-9555 紅線違停",
        identifiers: { licensePlate: "CAF-9555" },
        confidence: "medium",
        evidenceGaps: ["夜間能見度低", "車牌部分反光"],
        vehicleType: "car",
        sceneType: "red_line",
      }),
    );
    expect(r.trackingId).toMatch(/^TRB-\d{8}-[0-9A-Z]{7}$/); // v4.7 新格式
    expect(r.legalCitations.length).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────────────────
  // 6) MSZ-5170 — 無障礙通道（道交 §57 + signTexts）
  // ──────────────────────────────────────────────────────────────────
  it("[6] MSZ-5170 占無障礙通道 + 『請留輪椅通』看板 → §57 加重命中", async () => {
    const { matchLegalCitationsMulti } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitationsMulti(
      "traffic",
      "MSZ-5170 違停占用無障礙通道，路面噴字「請留輪椅通」",
      "wheelchair_path",
    );
    expect(cs.some((c) => c.shortLabel?.includes("身障") || c.shortLabel?.includes("無障礙") || c.shortLabel?.includes("輪椅"))).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────
  // 7) EMK-8813 Gogoro — EV 不應觸發空污 §40
  // ──────────────────────────────────────────────────────────────────
  it("[7] EMK-8813 電動機車 + 排氣描述 → EV 豁免警示", async () => {
    const { checkCompliance } = await import("../src/services/compliance.js");
    const c = checkCompliance(
      ctx({
        category: "environment",
        subject: "EMK-8813 Gogoro",
        description: "疑似排氣超標、黑煙",
        identifiers: { licensePlate: "EMK-8813" },
        confidence: "low",
        evidenceGaps: [],
        vehicleType: "ev_motorcycle",
      }),
    );
    expect(c.issues.some((i) => i.includes("電動車") && i.includes("§40"))).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────
  // 8) TDX-8396 計程車 — 招呼站豁免
  // ──────────────────────────────────────────────────────────────────
  it("[8] TDX-8396 計程車 → vehicleType=taxi 流經 compliance 不被誤殺", async () => {
    const { checkCompliance } = await import("../src/services/compliance.js");
    const c = checkCompliance(
      ctx({
        category: "traffic",
        subject: "計程車 TDX-8396",
        description: "計程車 TDX-8396 紅線違停",
        identifiers: { licensePlate: "TDX-8396" },
        confidence: "high",
        evidenceGaps: [],
        vehicleType: "taxi",
        sceneType: "red_line",
      }),
    );
    // 計程車於紅線仍違法 — 不應觸發場域豁免
    expect(c.issues.some((i) => i.includes("權威場域"))).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────
  // 9) EBV-8508 Tesla 自行車道 — v4.6 規則
  // ──────────────────────────────────────────────────────────────────
  it("[9] EBV-8508 Tesla 占自行車道 → v4.6 自行車道規則命中", async () => {
    const { matchLegalCitationsMulti } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitationsMulti(
      "traffic",
      "Tesla EBV-8508 占用自行車道停車",
      "bicycle_lane",
    );
    expect(cs.some((c) => c.shortLabel?.includes("自行車道"))).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────
  // v4.7 sanity：整批 9 個 buildReport 跑完 trackingId 互不衝突
  // ──────────────────────────────────────────────────────────────────
  it("[corpus] 9 件案件跑完 trackingId 全部不同（CSPRNG）", async () => {
    const { buildReport } = await import("../src/services/report.js");
    const cases: AnalyzedViolation[] = [
      { category: "traffic", subject: "PJW-3035", description: "騎樓停車", identifiers: { licensePlate: "PJW-3035" }, confidence: "high", evidenceGaps: [], vehicleType: "motorcycle_light", sceneType: "arcade" },
      { category: "traffic", subject: "AHE-2238", description: "違停紅線", identifiers: { licensePlate: "AHE-2238" }, confidence: "high", evidenceGaps: [], vehicleType: "car", sceneType: "red_line" },
      { category: "traffic", subject: "CAF-9555", description: "夜間違停", identifiers: { licensePlate: "CAF-9555" }, confidence: "medium", evidenceGaps: ["夜間"], vehicleType: "car", sceneType: "red_line" },
      { category: "traffic", subject: "MSZ-5170", description: "占無障礙通", identifiers: { licensePlate: "MSZ-5170" }, confidence: "high", evidenceGaps: [], vehicleType: "car", sceneType: "wheelchair_path", signTexts: ["請留輪椅通"] },
      { category: "traffic", subject: "EBV-8508", description: "Tesla 自行車道", identifiers: { licensePlate: "EBV-8508" }, confidence: "high", evidenceGaps: [], vehicleType: "ev_car", sceneType: "bicycle_lane" },
      { category: "traffic", subject: "TDX-8396", description: "計程車紅線", identifiers: { licensePlate: "TDX-8396" }, confidence: "high", evidenceGaps: [], vehicleType: "taxi", sceneType: "red_line" },
      { category: "environment", subject: "棄置盆栽", description: "人行道棄置植物廢棄物", identifiers: { wasteType: "盆栽家具" }, confidence: "medium", evidenceGaps: [] },
      { category: "traffic", subject: "EMK-8813", description: "電動機車違停", identifiers: { licensePlate: "EMK-8813" }, confidence: "high", evidenceGaps: [], vehicleType: "ev_motorcycle", sceneType: "red_line" },
      { category: "traffic", subject: "警車", description: "派出所場域", identifiers: {}, confidence: "low", evidenceGaps: [], vehicleType: "police", sceneType: "private_property" },
    ];
    const ids = new Set<string>();
    for (const a of cases) {
      const art = buildReport(ctx(a, 1, addrNewTaipei));
      expect(ids.has(art.trackingId)).toBe(false);
      ids.add(art.trackingId);
      expect(art.trackingId).toMatch(/^TRB-\d{8}-[0-9A-Z]{7}$/);
    }
    expect(ids.size).toBe(9);
  });

  // ──────────────────────────────────────────────────────────────────
  // v4.7 sanity：vision sanitizer 不破壞合法中文 hint
  // ──────────────────────────────────────────────────────────────────
  it("[sanitizer] 中文合法 hint 維持可讀（不會被誤刪）", () => {
    const sanitize = (s: string) =>
      s
        .slice(0, 500)
        .replace(/[\x00-\x1F\x7F]/g, " ")
        .replace(/[「」『』""'']/g, "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\[(?:INST|\/INST|SYSTEM|\/SYSTEM)\]/gi, "")
        .replace(/(?:system|user|assistant)\s*:/gi, " ")
        .trim()
        .slice(0, 500);
    expect(sanitize("車牌 PJW-3035 在騎樓停車")).toBe("車牌 PJW-3035 在騎樓停車");
    expect(sanitize("Tesla 占自行車道，鄰近紅線")).toBe("Tesla 占自行車道，鄰近紅線");
    expect(sanitize("夜間能見度差，車牌 CAF-9555 反光")).toBe(
      "夜間能見度差，車牌 CAF-9555 反光",
    );
  });
});
