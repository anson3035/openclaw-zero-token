import { describe, expect, it } from "vitest";
import { buildReport } from "../src/services/report.js";
import type { MediaEvidence, ReportContext } from "../src/types.js";

function evidence(overrides: Partial<MediaEvidence> = {}): MediaEvidence {
  return {
    filePath: "/tmp/test.jpg",
    mimeType: "image/jpeg",
    capturedAt: new Date("2026-05-23T10:00:00+08:00"),
    gps: { lat: 25.0478, lon: 121.5319 },
    sha256: "a".repeat(64),
    source: "telegram",
    sourceMessageId: 1,
    sourceChatId: 100,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ReportContext> = {}): ReportContext {
  return {
    evidence: [evidence()],
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
    reporter: { name: "王小明", contact: "0912-345678" },
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

  it("includes reporter identity when set", () => {
    const r = buildReport(makeCtx());
    expect(r.markdown).toContain("王小明");
    expect(r.markdown).toContain("0912-345678");
  });

  it("flags missing reporter via compliance check", () => {
    const r = buildReport(makeCtx({ reporter: undefined }));
    expect(r.compliance.ok).toBe(false);
    expect(r.compliance.issues.join("\n")).toContain("具名");
  });

  it("renders SHA256 fingerprint for each evidence", () => {
    const r = buildReport(makeCtx());
    expect(r.markdown).toContain("SHA256");
    expect(r.markdown).toContain("aaaaaaaaaaaaaaaa");
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
          identifiers: { licensePlate: "XYZ-9999" },
          confidence: "low",
          evidenceGaps: ["車牌模糊難以辨識", "時間戳記缺失"],
        },
        evidence: [
          evidence({ filePath: "/tmp/a.jpg", capturedAt: new Date("2026-05-23T10:00:00+08:00") }),
          evidence({ filePath: "/tmp/b.jpg", capturedAt: new Date("2026-05-23T10:05:00+08:00") }),
        ],
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

  it("embeds reporter block in the email body", () => {
    const r = buildReport(
      makeCtx({
        reporter: { name: "李大華", contact: "lee@example.com", nationalId: "A123456789" },
      }),
    );
    expect(r.emailBody).toContain("李大華");
    expect(r.emailBody).toContain("lee@example.com");
    expect(r.emailBody).toContain("末四碼：6789");
    expect(r.emailBody).not.toContain("A123456789"); // full ID never appears in body
  });

  it("attaches SHA256 fingerprints to email body for chain-of-custody", () => {
    const r = buildReport(makeCtx());
    expect(r.emailBody).toContain("SHA256");
    expect(r.emailBody).toContain("a".repeat(64));
  });

  it("renders the 💰 reward banner for environmental cases that qualify", () => {
    const r = buildReport(
      makeCtx({
        analysis: {
          category: "environment",
          subject: "路邊亂丟垃圾",
          description: "路邊隨意亂丟垃圾",
          identifiers: { wasteType: "家庭垃圾" },
          confidence: "high",
          evidenceGaps: [],
        },
      }),
    );
    expect(r.markdown).toContain("💰");
    expect(r.markdown).toContain("舉發獎金");
    expect(r.markdown).toContain("罰鍰之");
  });

  it("does NOT render reward banner for traffic-parking cases (2022 reform)", () => {
    const r = buildReport(makeCtx()); // default = 紅線 traffic
    expect(r.markdown).not.toContain("💰");
    expect(r.markdown).not.toContain("舉發獎金");
  });

  it("renders the tiered reward note for hazardous-waste dumping", () => {
    const r = buildReport(
      makeCtx({
        analysis: {
          category: "environment",
          subject: "事業廢棄物傾倒",
          description: "違法傾倒有害事業廢棄物於山區",
          identifiers: { wasteType: "事業廢棄物" },
          confidence: "high",
          evidenceGaps: [],
        },
      }),
    );
    expect(r.markdown).toContain("💰");
    expect(r.markdown).toMatch(/萬/);
  });
});
