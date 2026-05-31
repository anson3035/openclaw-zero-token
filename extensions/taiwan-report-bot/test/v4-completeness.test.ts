import { describe, expect, it } from "vitest";
import {
  matchLegalCitations,
  matchLegalCitationsMulti,
} from "../src/data/legal-rules.js";
import { checkCompliance } from "../src/services/compliance.js";
import type { AnalyzedViolation, MediaEvidence, ReportContext } from "../src/types.js";

function evidence(): MediaEvidence {
  return {
    filePath: "/tmp/x.jpg",
    mimeType: "image/jpeg",
    capturedAt: new Date(),
    sha256: "x".repeat(64),
    source: "telegram",
    sourceMessageId: 1,
    sourceChatId: 1,
  };
}

const baseAddress = {
  full: "台北市中正區某路 1 號",
  city: "台北市",
  source: "user-input" as const,
};
const reporter = { name: "王小明", contact: "0912-345-678" };

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
    address: baseAddress,
    reporter,
  };
}

describe("v4.2 — 建築法 §90 騎樓淨空", () => {
  it("騎樓違停命中 §90", () => {
    const cs = matchLegalCitations("building", "機車違停於騎樓");
    expect(cs.some((c) => c.statute === "建築法" && c.article.includes("90"))).toBe(true);
  });

  it("罰鍰金額正確（6000-30000）", () => {
    const cs = matchLegalCitations("building", "騎樓堆置雜物");
    const arcadeRule = cs.find((c) => c.shortLabel?.includes("騎樓"));
    expect(arcadeRule?.penalty).toMatch(/6,000.+30,000/);
  });
});

describe("v4.2 — 身障權益法 §57 無障礙通道", () => {
  it("無障礙通道命中身障權益法", () => {
    const cs = matchLegalCitations("building", "佔用無障礙通道");
    expect(cs.some((c) => c.statute === "身心障礙者權益保障法")).toBe(true);
  });

  it("輪椅通道亦命中", () => {
    const cs = matchLegalCitations("building", "停放於輪椅通道");
    expect(cs.some((c) => c.statute === "身心障礙者權益保障法")).toBe(true);
  });
});

describe("v4.2 — sceneType 驅動精確路由", () => {
  it("sceneType=arcade 即使描述無「騎樓」字也能命中", () => {
    const cs = matchLegalCitations("traffic", "Gogoro 停在屋簷下方", "arcade");
    expect(cs.some((c) => c.shortLabel?.includes("騎樓"))).toBe(true);
  });

  it("sceneType=red_line 自動命中紅線停車", () => {
    const cs = matchLegalCitations("traffic", "Toyota 違停", "red_line");
    expect(cs.some((c) => c.shortLabel?.includes("紅線"))).toBe(true);
  });

  it("sceneType=wheelchair_path 自動命中", () => {
    const cs = matchLegalCitations(
      "building",
      "機車違停於畫面右側",
      "wheelchair_path",
    );
    expect(cs.some((c) => c.statute === "身心障礙者權益保障法")).toBe(true);
  });
});

describe("v4.2 — matchLegalCitationsMulti 跨類別並查", () => {
  it("騎樓違停同時命中 §56-1-4（traffic）+ §90（building）", () => {
    const cs = matchLegalCitationsMulti("traffic", "機車違停於騎樓", "arcade");
    expect(cs.some((c) => c.article.includes("56"))).toBe(true);
    expect(cs.some((c) => c.statute === "建築法" && c.article.includes("90"))).toBe(true);
  });

  it("無障礙通道違停同時命中 §56-1-4 + 身障 §57", () => {
    const cs = matchLegalCitationsMulti(
      "traffic",
      "機車違停於人行道",
      "wheelchair_path",
    );
    expect(cs.some((c) => c.statute === "道路交通管理處罰條例")).toBe(true);
    expect(cs.some((c) => c.statute === "身心障礙者權益保障法")).toBe(true);
  });

  it("一般紅線違停不會誤加 §90", () => {
    const cs = matchLegalCitationsMulti("traffic", "違停紅線", "red_line");
    expect(cs.every((c) => c.statute !== "建築法")).toBe(true);
  });
});

describe("v4.2 — compliance 場域豁免", () => {
  it("private_property + police 車 → 主動阻擋", () => {
    const r = checkCompliance(
      ctx({
        category: "traffic",
        sceneType: "private_property",
        vehicleType: "police",
        description: "警車停放於派出所內",
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/權威場域|警車/);
  });

  it("government 公務車 → 主動阻擋", () => {
    const r = checkCompliance(
      ctx({
        vehicleType: "government",
        sceneType: "private_property",
        description: "公務車於指定處停放",
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("一般小客車不會被豁免擋下", () => {
    const r = checkCompliance(
      ctx({
        vehicleType: "car",
        sceneType: "red_line",
        description: "白色 Toyota 違停於紅線",
      }),
    );
    expect(r.issues.join("\n")).not.toMatch(/權威場域/);
  });
});

describe("v4.2 — EV 排氣豁免", () => {
  it("EV 機車 + 排氣描述 → compliance 主動指正", () => {
    const r = checkCompliance(
      ctx({
        category: "environment",
        vehicleType: "ev_motorcycle",
        description: "電動機車排氣超標",
      }),
    );
    expect(r.issues.join("\n")).toMatch(/電動車|排氣超標/);
  });

  it("EV 車 + 違停描述（無排氣）→ 不誤觸豁免", () => {
    const r = checkCompliance(
      ctx({
        vehicleType: "ev_motorcycle",
        sceneType: "arcade",
        description: "電動機車違停於騎樓",
      }),
    );
    expect(r.issues.join("\n")).not.toMatch(/EV.*排氣/);
  });
});
