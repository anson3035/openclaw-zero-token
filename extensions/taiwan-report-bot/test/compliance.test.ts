import { describe, expect, it } from "vitest";
import { checkCompliance } from "../src/services/compliance.js";
import type { MediaEvidence, ReportContext } from "../src/types.js";

function evidence(at: string): MediaEvidence {
  return {
    filePath: "/tmp/x.jpg",
    mimeType: "image/jpeg",
    capturedAt: new Date(at),
    gps: { lat: 25.04, lon: 121.53 },
    sha256: "c".repeat(64),
    source: "telegram",
    sourceMessageId: 1,
    sourceChatId: 1,
  };
}

// 黃線 / 一般違停 — 需 ≥2 張、間隔 ≥3 分鐘
const yellowLineAnalysis = {
  category: "traffic" as const,
  subject: "違停轎車",
  description: "白色轎車違停於黃線",
  identifiers: { licensePlate: "ABC-1234" },
  confidence: "high" as const,
  evidenceGaps: [],
};

// 紅線 / 人行道 — 單張即可
const redLineAnalysis = {
  category: "traffic" as const,
  subject: "違停機車",
  description: "機車違停於紅線",
  identifiers: { licensePlate: "ABC-1234" },
  confidence: "high" as const,
  evidenceGaps: [],
};

const sidewalkAnalysis = {
  category: "traffic" as const,
  subject: "違停 MPV",
  description: "Toyota Wish 佔用人行道停車",
  identifiers: { licensePlate: "BEA-9210" },
  confidence: "high" as const,
  evidenceGaps: [],
};

const baseAddress = {
  full: "台北市中正區忠孝東路一段1號",
  city: "台北市",
  source: "exif-geocode" as const,
};

const baseReporter = { name: "王小明", contact: "0912-345678" };

describe("checkCompliance", () => {
  it("blocks when reporter identity is missing", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00"), evidence("2026-05-23T10:05:00+08:00")],
      analysis: yellowLineAnalysis,
      address: baseAddress,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toContain("具名");
  });

  // ---- 紅線 / 人行道 / 騎樓 等「禁止臨時停車」場所 ----

  it("PASSES 紅線 violation with a single photo (即時違規，無需間隔證據)", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: redLineAnalysis,
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("PASSES 人行道 violation with a single photo", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: sidewalkAnalysis,
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(true);
  });

  it("PASSES 騎樓 violation with a single photo", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: { ...redLineAnalysis, description: "機車違停於騎樓" },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(true);
  });

  it("PASSES 消防栓 violation with a single photo", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: { ...redLineAnalysis, description: "汽車停放於消防栓 3 公尺內" },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(true);
  });

  // ---- 黃線 / 限時停車 / 一般違停 — 需持續性證據 ----

  it("blocks 黃線 violation with a single photo", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: yellowLineAnalysis,
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/2 張以上/);
  });

  it("blocks 黃線 violation when interval < 3 minutes", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00"), evidence("2026-05-23T10:01:00+08:00")],
      analysis: yellowLineAnalysis,
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/間隔/);
  });

  it("warns when 黃線 multi-photo lacks EXIF timestamps", () => {
    const r = checkCompliance({
      evidence: [
        { ...evidence("2026-05-23T10:00:00+08:00"), capturedAt: undefined },
        { ...evidence("2026-05-23T10:05:00+08:00"), capturedAt: undefined },
      ],
      analysis: yellowLineAnalysis,
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toContain("EXIF");
  });

  it("PASSES 黃線 violation with ≥ 2 photos and ≥ 3 min apart", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00"), evidence("2026-05-23T10:05:00+08:00")],
      analysis: yellowLineAnalysis,
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("PASSES generic 違停 (no specific marking) with two timely photos", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00"), evidence("2026-05-23T10:05:00+08:00")],
      analysis: { ...yellowLineAnalysis, description: "汽車違停於路邊" },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(true);
  });

  it("blocks generic 違停 with a single photo (conservative default)", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: { ...yellowLineAnalysis, description: "汽車違停於路邊" },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/2 張以上/);
  });

  // ---- 其他類型 ----

  it("does not require ≥ 2 photos for non-stopping traffic violations", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: {
        ...redLineAnalysis,
        description: "機車闖紅燈通過路口",
      },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(true);
  });

  it("does not require ≥ 2 photos for non-traffic categories", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: {
        ...redLineAnalysis,
        category: "environment",
        description: "路邊隨意亂丟垃圾",
        identifiers: {},
      },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(true);
  });

  it("blocks traffic violation without license plate", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00"), evidence("2026-05-23T10:05:00+08:00")],
      analysis: { ...yellowLineAnalysis, identifiers: {} },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/車牌/);
  });

  it("flags missing address placeholder", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: redLineAnalysis,
      address: { full: "（未取得地址，請使用 /address 補上）", source: "user-input" },
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/地址/);
  });

  // ---- §7-1 民眾檢舉適用性 ----

  it("BLOCKS overspeed violation (limited to police enforcement)", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: {
        category: "traffic",
        subject: "超速車輛",
        description: "汽車於市區道路超速",
        identifiers: { licensePlate: "ABC-1234" },
        confidence: "high",
        evidenceGaps: [],
      },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/不在民眾檢舉適用範圍/);
  });

  it("BLOCKS DUI report (限警察攔檢)", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: {
        category: "traffic",
        subject: "疑似酒駕車輛",
        description: "駕駛人疑似酒駕",
        identifiers: { licensePlate: "ABC-1234" },
        confidence: "high",
        evidenceGaps: [],
      },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/不在民眾檢舉適用範圍/);
  });

  it("BLOCKS no-helmet report", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: {
        category: "traffic",
        subject: "機車騎士",
        description: "機車駕駛未戴安全帽",
        identifiers: { licensePlate: "ABC-1234" },
        confidence: "high",
        evidenceGaps: [],
      },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/不在民眾檢舉適用範圍/);
  });

  it("PASSES 闖紅燈 with a single clear photo (moving violation, citizen reportable)", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: {
        category: "traffic",
        subject: "汽車",
        description: "汽車闖紅燈通過路口",
        identifiers: { licensePlate: "ABC-1234" },
        confidence: "high",
        evidenceGaps: [],
      },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(true);
  });

  it("PASSES 未禮讓行人 (moving, citizen reportable)", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: {
        category: "traffic",
        subject: "汽車",
        description: "汽車未禮讓行人通過斑馬線",
        identifiers: { licensePlate: "ABC-1234" },
        confidence: "high",
        evidenceGaps: [],
      },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(true);
  });

  // ---- 車牌人工核可 gate ----

  it("BLOCKS send when plate requires verification and user hasn't confirmed", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: redLineAnalysis,
      address: baseAddress,
      reporter: baseReporter,
      plateRequiresVerification: true,
      plateConfirmed: false,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/人工核可/);
    expect(r.issues.join("\n")).toMatch(/\/plate/);
  });

  it("PASSES when plate is flagged for verification BUT user has confirmed it", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: redLineAnalysis,
      address: baseAddress,
      reporter: baseReporter,
      plateRequiresVerification: true,
      plateConfirmed: true,
    });
    expect(r.ok).toBe(true);
  });

  it("PASSES when LPR is high-confidence and doesn't need verification", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: redLineAnalysis,
      address: baseAddress,
      reporter: baseReporter,
      plateRequiresVerification: false,
    });
    expect(r.ok).toBe(true);
  });
});
