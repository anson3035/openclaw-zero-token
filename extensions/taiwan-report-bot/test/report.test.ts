import { describe, expect, it } from "vitest";
import { buildReport } from "../src/services/report.js";
import type { ReportContext } from "../src/types.js";

function makeCtx(overrides: Partial<ReportContext> = {}): ReportContext {
  return {
    evidence: {
      filePath: "/tmp/test.jpg",
      mimeType: "image/jpeg",
      capturedAt: new Date("2026-05-23T10:00:00+08:00"),
      gps: { lat: 25.0478, lon: 121.5319 },
      source: "telegram",
      sourceMessageId: 1,
      sourceChatId: 100,
    },
    analysis: {
      category: "traffic",
      subject: "黑色機車車牌 ABC-1234",
      description: "機車違停於紅線斑馬線旁",
      identifiers: { licensePlate: "ABC-1234" },
      confidence: "high",
      evidenceGaps: [],
    },
    address: {
      full: "台北市中正區忠孝東路一段1號",
      city: "台北市",
      source: "exif-geocode",
    },
    ...overrides,
  };
}

describe("report builder", () => {
  it("emits full markdown with all required sections", () => {
    const r = buildReport(makeCtx());
    expect(r.markdown).toContain("違規檢舉報告書");
    expect(r.markdown).toContain("交通違規");
    expect(r.markdown).toContain("ABC-1234");
    expect(r.markdown).toContain("台北市中正區忠孝東路一段1號");
    expect(r.markdown).toContain("道路交通管理處罰條例");
  });

  it("includes license plate in email subject", () => {
    const r = buildReport(makeCtx());
    expect(r.emailSubject).toContain("ABC-1234");
    expect(r.emailSubject).toContain("交通違規");
  });

  it("appends condominium-specific notice when applicable", () => {
    const r = buildReport(
      makeCtx({
        analysis: {
          category: "condominium",
          subject: "走廊堆置雜物",
          description: "佔用公共走廊堆放紙箱與雜物",
          identifiers: { occupiedArea: "三樓走廊" },
          confidence: "high",
          evidenceGaps: [],
        },
      }),
    );
    expect(r.markdown).toContain("管委會");
  });

  it("appends emergency notice for building violations", () => {
    const r = buildReport(
      makeCtx({
        analysis: {
          category: "building",
          subject: "頂樓加蓋",
          description: "頂樓加蓋鐵皮屋未經許可",
          identifiers: { structureDescription: "鐵皮屋" },
          confidence: "medium",
          evidenceGaps: [],
        },
      }),
    );
    expect(r.markdown).toContain("緊急通報");
    expect(r.markdown).toContain("110");
  });

  it("flags evidence gaps when present", () => {
    const r = buildReport(
      makeCtx({
        analysis: {
          category: "traffic",
          subject: "車輛",
          description: "違停",
          identifiers: {},
          confidence: "low",
          evidenceGaps: ["車牌模糊難以辨識", "時間戳記缺失"],
        },
      }),
    );
    expect(r.markdown).toContain("車牌模糊");
    expect(r.markdown).toContain("時間戳記缺失");
  });

  it("builds prefilled online form URL when authority provides one", () => {
    const r = buildReport(makeCtx());
    expect(r.onlineFormUrl).toBeDefined();
    expect(r.onlineFormUrl).toContain("plate=ABC-1234");
  });

  it("routes Taipei traffic to TPD email", () => {
    const r = buildReport(makeCtx());
    expect(r.recipients[0]).toContain("taipei.gov.tw");
  });

  it("falls back to national email for unknown city", () => {
    const r = buildReport(
      makeCtx({
        address: {
          full: "未知地點",
          source: "user-input",
        },
      }),
    );
    expect(r.recipients[0]).toContain("npa.gov.tw");
  });
});
