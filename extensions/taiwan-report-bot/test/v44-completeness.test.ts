import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "trb-v44-"));
  process.env.DATA_DIR = dir;
  process.env.EVIDENCE_DIR = join(dir, "ev");
  process.env.TELEGRAM_BOT_TOKEN = "0000000000:test_token_long_enough";
  process.env.OPENAI_API_KEY = "sk-test-long-enough-key";
  const cfg = await import("../src/config.js");
  cfg.resetConfigForTests();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("v4.4 — trackingId 內部追蹤號", () => {
  it("buildReport 自動產生 TRB-YYYYMMDD-NNNNN 格式", async () => {
    const { buildReport } = await import("../src/services/report.js");
    const r = buildReport({
      evidence: [
        {
          filePath: "/tmp/x.jpg",
          mimeType: "image/jpeg",
          sha256: "z".repeat(64),
          source: "telegram",
          sourceMessageId: 1,
          sourceChatId: 1,
        },
      ],
      analysis: {
        category: "traffic",
        subject: "test",
        description: "違停紅線",
        identifiers: { licensePlate: "ABC-1235" },
        confidence: "high",
        evidenceGaps: [],
      },
      address: { full: "台北市某路 1 號", city: "台北市", source: "user-input" },
      reporter: { name: "王小明", contact: "0912-345-678" },
    });
    // v4.7 安全強化：trackingId 改用 CSPRNG base36（7 碼），不再用 Math.random 5 碼
    expect(r.trackingId).toMatch(/^TRB-\d{8}-[0-9A-Z]{7}$/);
  });

  it("Markdown 標明非官方受文號", async () => {
    const { buildReport } = await import("../src/services/report.js");
    const r = buildReport({
      evidence: [
        {
          filePath: "/tmp/x.jpg",
          mimeType: "image/jpeg",
          sha256: "z".repeat(64),
          source: "telegram",
          sourceMessageId: 1,
          sourceChatId: 1,
        },
      ],
      analysis: {
        category: "traffic",
        subject: "test",
        description: "違停紅線",
        identifiers: { licensePlate: "ABC-1235" },
        confidence: "high",
        evidenceGaps: [],
      },
      address: { full: "台北市某路 1 號", city: "台北市", source: "user-input" },
      reporter: { name: "王小明", contact: "0912-345-678" },
    });
    expect(r.markdown).toMatch(/非主管機關官方受文號/);
    expect(r.markdown).toContain(r.trackingId);
  });
});

describe("v4.4 — 歷史案件查詢", () => {
  it("無紀錄回空陣列", async () => {
    const { listUserCases } = await import("../src/services/history.js");
    const cases = await listUserCases("user:nonexistent");
    expect(cases).toEqual([]);
  });

  it("查得自己的案件，不洩漏他人的", async () => {
    const now = new Date();
    const lines = [
      JSON.stringify({
        ts: new Date(now.getTime() - 1000).toISOString(),
        type: "report_built",
        subject: "user:mine",
        meta: { trackingId: "TRB-20260601-00001", plate: "ABC-1235", address: "A 路" },
      }),
      JSON.stringify({
        ts: now.toISOString(),
        type: "sent",
        subject: "user:mine",
        meta: { trackingId: "TRB-20260601-00001", accepted: ["a@b.gov.tw"], messageId: "<m1>" },
      }),
      JSON.stringify({
        ts: now.toISOString(),
        type: "sent",
        subject: "user:OTHER",
        meta: { trackingId: "TRB-20260601-99999", accepted: ["x@y.gov.tw"] },
      }),
    ];
    await writeFile(join(dir, "audit.log.jsonl"), lines.join("\n"), "utf8");
    const { listUserCases } = await import("../src/services/history.js");
    const cases = await listUserCases("user:mine");
    expect(cases).toHaveLength(1);
    expect(cases[0]?.trackingId).toBe("TRB-20260601-00001");
    expect(cases[0]?.plate).toBe("ABC-1235");
    expect(cases[0]?.recipient).toBe("a@b.gov.tw");
  });

  it("按時間倒序排列", async () => {
    const lines = [
      JSON.stringify({
        ts: "2026-01-01T00:00:00Z",
        type: "sent",
        subject: "user:x",
        meta: { trackingId: "OLD" },
      }),
      JSON.stringify({
        ts: "2026-06-01T00:00:00Z",
        type: "sent",
        subject: "user:x",
        meta: { trackingId: "NEW" },
      }),
    ];
    await writeFile(join(dir, "audit.log.jsonl"), lines.join("\n"), "utf8");
    const { listUserCases } = await import("../src/services/history.js");
    const cases = await listUserCases("user:x");
    expect(cases.map((c) => c.trackingId)).toEqual(["NEW", "OLD"]);
  });

  it("getUserCase 找特定 trackingId", async () => {
    const lines = [
      JSON.stringify({
        ts: "2026-06-01T00:00:00Z",
        type: "sent",
        subject: "user:x",
        meta: { trackingId: "TRB-FIND-ME" },
      }),
    ];
    await writeFile(join(dir, "audit.log.jsonl"), lines.join("\n"), "utf8");
    const { getUserCase } = await import("../src/services/history.js");
    const found = await getUserCase("user:x", "TRB-FIND-ME");
    expect(found?.trackingId).toBe("TRB-FIND-ME");
    const notFound = await getUserCase("user:x", "NONEXISTENT");
    expect(notFound).toBeUndefined();
  });
});

describe("v4.4 — PDF 報告產生", () => {
  it("能產生有內容的 PDF 檔（不檢查視覺，只檢查檔案大小）", async () => {
    const { generateReportPdf } = await import("../src/services/pdf.js");
    const { buildReport } = await import("../src/services/report.js");
    const ctx = {
      evidence: [
        {
          filePath: "/tmp/nonexistent.jpg",
          mimeType: "image/jpeg",
          sha256: "z".repeat(64),
          source: "telegram" as const,
          sourceMessageId: 1,
          sourceChatId: 1,
        },
      ],
      analysis: {
        category: "traffic" as const,
        subject: "test",
        description: "違停紅線",
        identifiers: { licensePlate: "ABC-1235" },
        confidence: "high" as const,
        evidenceGaps: [],
      },
      address: { full: "台北市某路 1 號", city: "台北市", source: "user-input" as const },
      reporter: { name: "王小明", contact: "0912-345-678" },
    };
    const artifact = buildReport(ctx);
    const out = join(dir, "test.pdf");
    await generateReportPdf(artifact, ctx, out, { includeImage: false });
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(1000); // PDF 至少 1KB
  });
});

describe("v4.4 — 隱私馬賽克處理", () => {
  it("無區域時直接複製檔案不報錯", async () => {
    const sharp = (await import("sharp")).default;
    const inPath = join(dir, "in.jpg");
    await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .toFile(inPath);
    const { applyPrivacyMask } = await import("../src/services/masking.js");
    const out = join(dir, "out.jpg");
    await applyPrivacyMask(inPath, [], out);
    const fs = await import("node:fs/promises");
    await fs.access(out); // 應該存在
  });

  it("有區域時產生模糊版本（檔案存在且大小合理）", async () => {
    const sharp = (await import("sharp")).default;
    const inPath = join(dir, "in.jpg");
    await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .jpeg()
      .toFile(inPath);
    const { applyPrivacyMask } = await import("../src/services/masking.js");
    const out = join(dir, "out.jpg");
    await applyPrivacyMask(
      inPath,
      [{ type: "face", reason: "test", bbox: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }],
      out,
    );
    const fs = await import("node:fs/promises");
    const stat = await fs.stat(out);
    expect(stat.size).toBeGreaterThan(500);
  });

  it("describePrivacyMasks 正確摘要區域類型", async () => {
    const { describePrivacyMasks } = await import("../src/services/masking.js");
    const desc = describePrivacyMasks([
      { type: "face", reason: "", bbox: { x: 0, y: 0, w: 0.1, h: 0.1 } },
      { type: "face", reason: "", bbox: { x: 0.1, y: 0, w: 0.1, h: 0.1 } },
      { type: "plate", reason: "", bbox: { x: 0.2, y: 0, w: 0.1, h: 0.1 } },
    ]);
    expect(desc).toContain("人臉 ×2");
    expect(desc).toContain("第三方車牌 ×1");
  });

  it("空陣列回「無需馬賽克處理」", async () => {
    const { describePrivacyMasks } = await import("../src/services/masking.js");
    expect(describePrivacyMasks([])).toBe("無需馬賽克處理。");
  });
});

describe("v4.4 — 多車牌批次（schema）", () => {
  it("additionalPlates 在 schema 中為 optional", async () => {
    const { buildReport } = await import("../src/services/report.js");
    const r = buildReport({
      evidence: [
        {
          filePath: "/tmp/x.jpg",
          mimeType: "image/jpeg",
          sha256: "z".repeat(64),
          source: "telegram",
          sourceMessageId: 1,
          sourceChatId: 1,
        },
      ],
      analysis: {
        category: "traffic",
        subject: "test",
        description: "違停紅線",
        identifiers: { licensePlate: "ABC-1235" },
        confidence: "high",
        evidenceGaps: [],
        additionalPlates: [
          { licensePlate: "DEF-5678", confidence: 0.91 },
          { licensePlate: "GHI-9012", confidence: 0.85 },
        ],
      },
      address: { full: "台北市某路 1 號", city: "台北市", source: "user-input" },
      reporter: { name: "王小明", contact: "0912-345-678" },
    });
    // 不影響主流程
    expect(r.trackingId).toBeDefined();
  });
});
