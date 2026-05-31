import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { matchLegalCitations } from "../src/data/legal-rules.js";
import { checkCompliance } from "../src/services/compliance.js";
import type { AnalyzedViolation, MediaEvidence, ReportContext } from "../src/types.js";

function evidence(): MediaEvidence {
  return {
    filePath: "/tmp/x.jpg",
    mimeType: "image/jpeg",
    capturedAt: new Date(),
    sha256: "y".repeat(64),
    source: "telegram",
    sourceMessageId: 1,
    sourceChatId: 1,
  };
}

function ctx(analysis: Partial<AnalyzedViolation>): ReportContext {
  return {
    evidence: [evidence()],
    analysis: {
      category: "traffic",
      subject: "test",
      description: "test",
      identifiers: { licensePlate: "ABC-1234" },
      confidence: "high",
      evidenceGaps: [],
      ...analysis,
    },
    address: { full: "台北市某路 1 號", city: "台北市", source: "user-input" },
    reporter: { name: "test", contact: "0912-345-678" },
  };
}

describe("v4.3 — 車檔越界專屬規則", () => {
  it("「車尾越過車檔」命中專屬規則", () => {
    const cs = matchLegalCitations(
      "traffic",
      "白色 Toyota RAV4 車尾越過車檔，延伸至紅磚人行道",
    );
    expect(
      cs.some((c) => c.shortLabel === "停車超出格線（車尾入侵人行道）"),
    ).toBe(true);
  });

  it("「超出停車格」亦命中", () => {
    const cs = matchLegalCitations("traffic", "車身超出停車格線");
    expect(
      cs.some((c) => c.shortLabel === "停車超出格線（車尾入侵人行道）"),
    ).toBe(true);
  });

  it("「跨越車檔」亦命中", () => {
    const cs = matchLegalCitations("traffic", "汽車跨越車檔停放");
    expect(
      cs.some((c) => c.shortLabel === "停車超出格線（車尾入侵人行道）"),
    ).toBe(true);
  });

  it("規則屬 instantaneous + owner liability", () => {
    const cs = matchLegalCitations("traffic", "車尾越過車檔");
    const rule = cs.find((c) => c.shortLabel === "停車超出格線（車尾入侵人行道）");
    expect(rule?.evidenceMode).toBe("instantaneous");
    expect(rule?.liabilityTarget).toBe("owner");
  });
});

describe("v4.3 — 告示牌 signTexts 證據加成", () => {
  it("signTexts 含「請留輪椅通道」+ 未設 sceneType → 補充身障 §57 提示", () => {
    const r = checkCompliance(
      ctx({
        signTexts: ["請留輪椅通道", "請勿停車"],
        description: "機車違停於人行道",
      }),
    );
    expect(r.issues.join("\n")).toMatch(/身心障礙者權益保障法|§57/);
  });

  it("已設 sceneType=wheelchair_path → 不重複提示（避免噪音）", () => {
    const r = checkCompliance(
      ctx({
        signTexts: ["請留輪椅通道"],
        sceneType: "wheelchair_path",
        description: "違停於無障礙通道",
      }),
    );
    expect(r.issues.filter((s) => s.includes("身心障礙者權益保障法")).length).toBeLessThanOrEqual(0);
  });

  it("無告示牌不觸發加成", () => {
    const r = checkCompliance(
      ctx({
        signTexts: [],
        description: "違停紅線",
      }),
    );
    expect(r.issues.join("\n")).not.toMatch(/告示/);
  });

  it("商店招牌類 signTexts 不誤觸禁停判定", () => {
    const r = checkCompliance(
      ctx({
        signTexts: ["燙髮 100 元", "歡迎光臨"],
        description: "違停紅線",
      }),
    );
    expect(r.issues.join("\n")).not.toMatch(/輪椅|無障礙/);
  });
});

describe("v4.3 — 連續舉發頻率警示", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "trb-freq-"));
    process.env.DATA_DIR = dir;
    process.env.TELEGRAM_BOT_TOKEN = "0000000000:test_token_long_enough";
    process.env.OPENAI_API_KEY = "sk-test-long-enough-key";
    const cfg = await import("../src/config.js");
    cfg.resetConfigForTests();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("無舉發紀錄 → 不提示", async () => {
    const { checkReportingFrequency } = await import("../src/services/compliance.js");
    const w = await checkReportingFrequency("user:abc");
    expect(w).toBeUndefined();
  });

  it("近 30 日 < 30 件 → 不提示", async () => {
    const now = new Date();
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(
        JSON.stringify({
          ts: new Date(now.getTime() - i * 86400000).toISOString(),
          type: "sent",
          subject: "user:abc",
        }),
      );
    }
    await writeFile(join(dir, "audit.log.jsonl"), lines.join("\n"), "utf8");
    const { checkReportingFrequency } = await import("../src/services/compliance.js");
    const w = await checkReportingFrequency("user:abc");
    expect(w).toBeUndefined();
  });

  it("近 30 日 ≥ 30 件 → 軟提示", async () => {
    const now = new Date();
    const lines: string[] = [];
    for (let i = 0; i < 35; i++) {
      lines.push(
        JSON.stringify({
          ts: new Date(now.getTime() - i * 12 * 3600 * 1000).toISOString(),
          type: "sent",
          subject: "user:abc",
        }),
      );
    }
    await writeFile(join(dir, "audit.log.jsonl"), lines.join("\n"), "utf8");
    const { checkReportingFrequency } = await import("../src/services/compliance.js");
    const w = await checkReportingFrequency("user:abc");
    expect(w).toBeDefined();
    expect(w).toMatch(/30 日已寄出/);
  });

  it("近 30 日 ≥ 100 件 → 強烈警示", async () => {
    const now = new Date();
    const lines: string[] = [];
    for (let i = 0; i < 110; i++) {
      lines.push(
        JSON.stringify({
          ts: new Date(now.getTime() - i * 3 * 3600 * 1000).toISOString(),
          type: "sent",
          subject: "user:abc",
        }),
      );
    }
    await writeFile(join(dir, "audit.log.jsonl"), lines.join("\n"), "utf8");
    const { checkReportingFrequency } = await import("../src/services/compliance.js");
    const w = await checkReportingFrequency("user:abc");
    expect(w).toMatch(/高頻舉發/);
    expect(w).toMatch(/2022 道交/);
  });

  it("不算其他人的舉發", async () => {
    const now = new Date();
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) {
      lines.push(
        JSON.stringify({
          ts: new Date(now.getTime() - i * 86400000 * 0.5).toISOString(),
          type: "sent",
          subject: "user:OTHER",
        }),
      );
    }
    await writeFile(join(dir, "audit.log.jsonl"), lines.join("\n"), "utf8");
    const { checkReportingFrequency } = await import("../src/services/compliance.js");
    const w = await checkReportingFrequency("user:abc");
    expect(w).toBeUndefined();
  });

  it("不算超過 30 天前的舉發", async () => {
    const now = new Date();
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) {
      // 全部都在 90 天前
      lines.push(
        JSON.stringify({
          ts: new Date(now.getTime() - 90 * 86400000 - i * 86400000).toISOString(),
          type: "sent",
          subject: "user:abc",
        }),
      );
    }
    await writeFile(join(dir, "audit.log.jsonl"), lines.join("\n"), "utf8");
    const { checkReportingFrequency } = await import("../src/services/compliance.js");
    const w = await checkReportingFrequency("user:abc");
    expect(w).toBeUndefined();
  });

  it("只算 'sent' 事件，不算 'analyzed' 或 'draft_viewed'", async () => {
    const now = new Date();
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) {
      lines.push(
        JSON.stringify({
          ts: new Date(now.getTime() - i * 3600 * 1000).toISOString(),
          type: "analyzed",
          subject: "user:abc",
        }),
      );
    }
    await writeFile(join(dir, "audit.log.jsonl"), lines.join("\n"), "utf8");
    const { checkReportingFrequency } = await import("../src/services/compliance.js");
    const w = await checkReportingFrequency("user:abc");
    expect(w).toBeUndefined();
  });
});
