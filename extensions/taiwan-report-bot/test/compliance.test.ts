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

const baseAnalysis = {
  category: "traffic" as const,
  subject: "違停機車",
  description: "機車違停於紅線",
  identifiers: { licensePlate: "ABC-1234" },
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
      analysis: baseAnalysis,
      address: baseAddress,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toContain("具名");
  });

  it("blocks continuous-parking traffic with single photo", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: baseAnalysis,
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/2 張以上/);
  });

  it("blocks when interval between photos is < 3 minutes", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00"), evidence("2026-05-23T10:01:00+08:00")],
      analysis: baseAnalysis,
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/間隔/);
  });

  it("warns when multiple photos lack EXIF timestamps", () => {
    const r = checkCompliance({
      evidence: [
        { ...evidence("2026-05-23T10:00:00+08:00"), capturedAt: undefined },
        { ...evidence("2026-05-23T10:05:00+08:00"), capturedAt: undefined },
      ],
      analysis: baseAnalysis,
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toContain("EXIF");
  });

  it("passes when reporter set + two photos ≥ 3 min apart + plate + address", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00"), evidence("2026-05-23T10:05:00+08:00")],
      analysis: baseAnalysis,
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("does not require ≥2 photos for non-continuous traffic violations", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: {
        ...baseAnalysis,
        description: "機車闖紅燈通過路口",
      },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(true);
  });

  it("does not require ≥2 photos for non-traffic categories", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00")],
      analysis: {
        ...baseAnalysis,
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
      analysis: { ...baseAnalysis, identifiers: {} },
      address: baseAddress,
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/車牌/);
  });

  it("flags missing address placeholder", () => {
    const r = checkCompliance({
      evidence: [evidence("2026-05-23T10:00:00+08:00"), evidence("2026-05-23T10:05:00+08:00")],
      analysis: baseAnalysis,
      address: { full: "（未取得地址，請使用 /address 補上）", source: "user-input" },
      reporter: baseReporter,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/地址/);
  });
});
