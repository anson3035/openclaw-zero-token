/**
 * v4.9 — 機車駕駛人吸菸（菸防法 §17 III 12 款）
 *
 * Trigger photos: 紅色 Vespa 風機車，車牌 672-JFM（兩張）。
 *   IMG_2833: 騎士右手持菸，無安全帽
 *   IMG_2834: 同騎士後視，仍無安全帽
 *
 * 期望命中：
 *   - 菸害防制法 §17 III ⑫ / §49（民眾可檢舉、衛生局裁罰、有獎金）
 *   - 道交 §31 第 6 項（限警察、應提示改撥 110）
 *
 * 注意：道交 §31 第 5 項僅罰「汽車」吸菸，不適用機車；
 *       不應同時命中。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "trb-v49-"));
  process.env.DATA_DIR = dir;
  process.env.TELEGRAM_BOT_TOKEN = "0000000000:test_token_for_unit_tests";
  process.env.OPENAI_API_KEY = "sk-test-unit";
  const cfg = await import("../src/config.js");
  cfg.resetConfigForTests();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("v4.9 — 機車吸菸（菸防法 §17 III ⑫）", () => {
  it("「機車駕駛人吸菸」命中菸防法 §17", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitations(
      "traffic",
      "機車 672-JFM 駕駛人吸菸",
    );
    expect(cs.some((c) => c.statute === "菸害防制法")).toBe(true);
  });

  it("「騎士手持菸」、「機車持菸」、「機車抽菸」皆命中", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    for (const desc of [
      "騎士手持菸騎乘紅色 Vespa",
      "機車駕駛人手持菸",
      "騎車抽菸不戴安全帽",
      "騎士抽菸",
      "機車點菸",
    ]) {
      const cs = matchLegalCitations("traffic", desc);
      expect(
        cs.some((c) => c.statute === "菸害防制法"),
        `desc=「${desc}」 未命中菸防法`,
      ).toBe(true);
    }
  });

  it("菸防法 §17 規則屬 driver liability + 民眾可檢舉 + 有獎金", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitations("traffic", "機車吸菸");
    const rule = cs.find((c) => c.statute === "菸害防制法");
    expect(rule?.liabilityTarget).toBe("driver");
    expect(rule?.reportableByCitizen).toBe(true);
    expect(rule?.evidenceMode).toBe("instantaneous");
    expect(rule?.reward?.available).toBe(true);
    expect(rule?.reward?.authority).toContain("衛生局");
  });

  it("汽車吸菸（既有 §31 第 5 項）依舊運作、不被菸防新規取代", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitations("traffic", "汽車駕駛人車內吸菸並亂丟菸蒂");
    expect(cs.some((c) => c.article.includes("第 31 條 第 5 項"))).toBe(true);
  });

  it("純文字「吸菸」（無「機車 / 騎」前綴）不誤觸菸防法 §17", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitations("traffic", "車內吸菸並丟菸蒂");
    // §31 第 5 項 命中（汽車）；菸防法 §17 不應命中（場景不明）
    expect(cs.some((c) => c.statute === "菸害防制法")).toBe(false);
  });
});

describe("v4.9 — 672-JFM 端到端 multi-citation", () => {
  it("IMG_2833 場景 → 菸防 §17 + 道交 §31 第 6 項 同時命中", async () => {
    const { matchLegalCitationsMulti } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitationsMulti(
      "traffic",
      "紅色 Vespa 672-JFM 騎士手持菸、未戴安全帽",
      undefined,
    );
    expect(cs.some((c) => c.statute === "菸害防制法")).toBe(true);
    expect(cs.some((c) => c.shortLabel?.includes("安全帽"))).toBe(true);
  });

  it("IMG_2834 場景（單純無安全帽後視）→ 道交 §31 第 6 項 限警察提示", async () => {
    const { matchLegalCitations } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitations(
      "traffic",
      "紅色機車 672-JFM 騎士未戴安全帽",
    );
    const helmet = cs.find((c) => c.shortLabel?.includes("安全帽"));
    expect(helmet).toBeDefined();
    expect(helmet?.reportableByCitizen).toBe(false);
  });

  it("compliance gate 對 IMG_2834 全限警察案件回報 §7-1 不適用", async () => {
    const { checkCompliance } = await import("../src/services/compliance.js");
    const c = checkCompliance({
      evidence: [
        {
          filePath: "/tmp/img2834.jpg",
          mimeType: "image/jpeg",
          sha256: "c".repeat(64),
          source: "telegram",
          sourceMessageId: 2,
          sourceChatId: 1,
          capturedAt: new Date(),
        },
      ],
      analysis: {
        category: "traffic",
        subject: "機車 672-JFM",
        description: "紅色機車 672-JFM 騎士未戴安全帽",
        identifiers: { licensePlate: "672-JFM" },
        confidence: "high",
        evidenceGaps: [],
        vehicleType: "motorcycle_light",
      },
      address: {
        full: "高雄市某區某街",
        city: "高雄市",
        source: "user-input",
      },
      reporter: { name: "王小明", contact: "0912-345678" },
    });
    // §31 第 6 項 reportableByCitizen=false → 應觸發 §7-1 不適用警告
    expect(c.issues.some((i) => i.includes("110") || i.includes("§7-1"))).toBe(true);
  });

  it("compliance gate 對 IMG_2833（持菸 + 無安全帽）— 菸防法 §17 ok 不被誤殺", async () => {
    const { checkCompliance } = await import("../src/services/compliance.js");
    const c = checkCompliance({
      evidence: [
        {
          filePath: "/tmp/img2833.jpg",
          mimeType: "image/jpeg",
          sha256: "d".repeat(64),
          source: "telegram",
          sourceMessageId: 1,
          sourceChatId: 1,
          capturedAt: new Date(),
        },
      ],
      analysis: {
        category: "traffic",
        subject: "機車 672-JFM",
        description: "紅色 Vespa 672-JFM 騎士右手持菸、未戴安全帽，行駛中",
        identifiers: { licensePlate: "672-JFM" },
        confidence: "high",
        evidenceGaps: [],
        vehicleType: "motorcycle_light",
      },
      address: {
        full: "高雄市某區某街",
        city: "高雄市",
        source: "user-input",
      },
      reporter: { name: "王小明", contact: "0912-345678" },
    });
    // 菸防法 §17 是民眾可檢舉條文 — 不應該整案被退
    // 但 §31 第 6 項（限警察）仍會提示「請改撥 110」
    expect(c.issues.some((i) => i.includes("110"))).toBe(true);
  });

  it("buildReport 對 IMG_2833 場景輸出兩條條文 + v4.7 trackingId", async () => {
    const { buildReport } = await import("../src/services/report.js");
    const r = buildReport({
      evidence: [
        {
          filePath: "/tmp/img2833.jpg",
          mimeType: "image/jpeg",
          sha256: "e".repeat(64),
          source: "telegram",
          sourceMessageId: 1,
          sourceChatId: 1,
          capturedAt: new Date(),
        },
      ],
      analysis: {
        category: "traffic",
        subject: "機車 672-JFM",
        description:
          "紅色 Vespa 風機車 672-JFM 騎士右手持菸騎乘，未戴安全帽",
        identifiers: { licensePlate: "672-JFM" },
        confidence: "high",
        evidenceGaps: [],
        vehicleType: "motorcycle_light",
      },
      address: { full: "高雄市某區", city: "高雄市", source: "user-input" },
      reporter: { name: "王小明", contact: "0912-345678" },
    });
    expect(r.trackingId).toMatch(/^TRB-\d{8}-[0-9A-Z]{7}$/);
    expect(r.legalCitations.some((c) => c.statute === "菸害防制法")).toBe(true);
    expect(
      r.legalCitations.some((c) => c.shortLabel?.includes("安全帽")),
    ).toBe(true);
    // Markdown 應包含獎金資訊（菸防法 §17 有獎金）
    expect(r.markdown).toMatch(/獎金|衛生局/);
  });
});
