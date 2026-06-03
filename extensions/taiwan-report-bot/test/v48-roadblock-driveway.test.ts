/**
 * v4.8 — 道路堆置障礙物 §82-1 + 出入口 5 m §56 I⑥
 *
 * Trigger photo: 白色 Toyota BJA-1925，前方放置三角錐 + 廢輪胎占道，
 * 疑似停於騎樓 / 車庫出入口前，畫面前方可見雙黃線。
 *
 * 先前版本沒有對應規則 — vision 模型即使正確識別到三角錐 / 廢輪胎，
 * legal-rules 也不會命中任何條文。本 v4.8 補上兩條規則並驗證命中。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "trb-v48-"));
  process.env.DATA_DIR = dir;
  process.env.TELEGRAM_BOT_TOKEN = "0000000000:test_token_for_unit_tests";
  process.env.OPENAI_API_KEY = "sk-test-unit";
  const cfg = await import("../src/config.js");
  cfg.resetConfigForTests();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("v4.8 — 道路堆置障礙物 §82-1", () => {
  it("「三角錐」命中專屬規則", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitations(
      "traffic",
      "BJA-1925 前方擺放三角錐占用車道",
    );
    expect(cs.some((c) => c.shortLabel?.includes("道路擺設障礙物"))).toBe(true);
  });

  it("「廢輪胎」命中（路霸常用占位道具）", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitations(
      "traffic",
      "車主以廢輪胎占地為王，私設停車位",
    );
    expect(cs.some((c) => c.shortLabel?.includes("道路擺設障礙物"))).toBe(true);
  });

  it("「占道」 / 「占地為王」 / 「路霸」 三種口語描述都命中", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    for (const desc of [
      "Toyota BJA-1925 占道停車",
      "屋主於騎樓前占地為王",
      "店家路霸行為，雜物堆置路面",
    ]) {
      const cs = matchLegalCitations("traffic", desc);
      expect(
        cs.some((c) => c.shortLabel?.includes("道路擺設障礙物")),
        `desc=「${desc}」 未命中`,
      ).toBe(true);
    }
  });

  it("§82-1 規則屬 instantaneous + 民眾可檢舉", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitations("traffic", "三角錐占道");
    const rule = cs.find((c) => c.shortLabel?.includes("道路擺設障礙物"));
    expect(rule?.evidenceMode).toBe("instantaneous");
    expect(rule?.reportableByCitizen).toBe(true);
    expect(rule?.article).toContain("82-1");
  });

  it("一般違停（紅線 / 黃線）描述不會誤觸 §82-1", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    for (const desc of ["違停紅線", "黃線停車", "Tesla 占用自行車道"]) {
      const cs = matchLegalCitations("traffic", desc);
      expect(
        cs.every((c) => !c.shortLabel?.includes("道路擺設障礙物")),
        `desc=「${desc}」 誤觸 §82-1`,
      ).toBe(true);
    }
  });
});

describe("v4.8 — 出入口 5 m §56 I⑥", () => {
  it("「擋住車庫」命中專屬規則", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitations(
      "traffic",
      "白車擋住住戶車庫鐵捲門",
    );
    expect(cs.some((c) => c.shortLabel?.includes("出入口"))).toBe(true);
  });

  it("「巷口違停」命中", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitations(
      "traffic",
      "Toyota 擋住巷口出入",
    );
    expect(cs.some((c) => c.shortLabel?.includes("出入口"))).toBe(true);
  });

  it("§56 I⑥ 規則屬 instantaneous + liability=owner", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitations("traffic", "車庫前停車擋住出入口");
    const rule = cs.find((c) => c.shortLabel?.includes("出入口"));
    expect(rule?.evidenceMode).toBe("instantaneous");
    expect(rule?.liabilityTarget).toBe("owner");
    expect(rule?.article).toContain("第 56 條");
    expect(rule?.article).toContain("第 6 款");
  });
});

describe("v4.8 — BJA-1925 端到端 multi-citation 場景", () => {
  it("三角錐 + 廢輪胎 + 車庫出入口 → §82-1 + §56 I⑥ 同時命中", async () => {
    const { matchLegalCitationsMulti } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitationsMulti(
      "traffic",
      "Toyota BJA-1925 停於車庫出入口前，並以三角錐與廢輪胎占道",
      undefined,
    );
    expect(cs.some((c) => c.shortLabel?.includes("道路擺設障礙物"))).toBe(true);
    expect(cs.some((c) => c.shortLabel?.includes("出入口"))).toBe(true);
  });

  it("buildReport 對 BJA-1925 場景產出符合 v4.7 trackingId 與多條文 Markdown", async () => {
    const { buildReport } = await import("../src/services/report.js");
    const r = buildReport({
      evidence: [
        {
          filePath: "/tmp/bja-1925.jpg",
          mimeType: "image/jpeg",
          sha256: "b".repeat(64),
          source: "telegram",
          sourceMessageId: 1,
          sourceChatId: 1,
          capturedAt: new Date(),
        },
      ],
      analysis: {
        category: "traffic",
        subject: "Toyota BJA-1925",
        description:
          "白色 Toyota BJA-1925 停於騎樓 / 車庫出入口前方，以三角錐與廢輪胎占道，疑似占地為王",
        identifiers: { licensePlate: "BJA-1925" },
        confidence: "high",
        evidenceGaps: ["時間戳記僅單張，宜補充間隔 3 分鐘以上之第二張"],
        vehicleType: "car",
        sceneType: "unknown",
        signTexts: ["Joy English"], // 補習班招牌（與違規無關）
      },
      address: {
        full: "高雄市某區某路某巷口",
        city: "高雄市",
        source: "user-input",
      },
      reporter: { name: "王小明", contact: "0912-345678" },
    });
    // v4.7 CSPRNG trackingId
    expect(r.trackingId).toMatch(/^TRB-\d{8}-[0-9A-Z]{7}$/);
    // 至少兩條 citation
    expect(r.legalCitations.length).toBeGreaterThanOrEqual(2);
    // Markdown 包含兩條核心條文
    expect(r.markdown).toMatch(/82-1/);
    expect(r.markdown).toMatch(/56/);
  });
});
