import { describe, expect, it } from "vitest";
import { normalizePhoneE164 } from "../src/data/authorities.js";
import { buildReport, buildSmsBody } from "../src/services/report.js";
import type { MediaEvidence, ReportContext } from "../src/types.js";

function evidence(overrides: Partial<MediaEvidence> = {}): MediaEvidence {
  return {
    filePath: "/tmp/test.jpg",
    mimeType: "image/jpeg",
    capturedAt: new Date("2026-05-23T10:00:00+08:00"),
    gps: { lat: 25.0478, lon: 121.5319 },
    sha256: "b".repeat(64),
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

describe("normalizePhoneE164", () => {
  it("converts Taiwan local format with dashes to +886", () => {
    expect(normalizePhoneE164("0911-510119")).toBe("+886911510119");
  });

  it("converts Taiwan local format without dashes", () => {
    expect(normalizePhoneE164("0911510119")).toBe("+886911510119");
  });

  it("preserves already-normalized numbers", () => {
    expect(normalizePhoneE164("+886911510119")).toBe("+886911510119");
  });

  it("strips non-digit characters", () => {
    expect(normalizePhoneE164("(0911) 510-119")).toBe("+886911510119");
  });
});

describe("buildSmsBody", () => {
  it("includes plate, time, address, and violation", () => {
    const body = buildSmsBody(makeCtx());
    expect(body).toContain("ABC-1234");
    expect(body).toContain("台北市");
    expect(body).toContain("違停");
  });

  it("truncates very long addresses to keep within SMS segment", () => {
    const body = buildSmsBody(
      makeCtx({
        address: {
          full: "台北市中正區忠孝東路一段一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十段巷弄號樓",
          city: "台北市",
          source: "user-input",
        },
      }),
    );
    expect(body).toContain("…");
  });

  it("falls back to '車牌不明' when license plate missing", () => {
    const body = buildSmsBody(
      makeCtx({
        analysis: {
          category: "traffic",
          subject: "車輛違停",
          description: "違停紅線",
          identifiers: {},
          confidence: "low",
          evidenceGaps: ["車牌模糊"],
        },
      }),
    );
    expect(body).toContain("車牌不明");
  });
});

describe("buildReport SMS artifact", () => {
  it("emits sms artifact with deep link for Taipei traffic violation", () => {
    const r = buildReport(makeCtx());
    expect(r.sms).toBeDefined();
    expect(r.sms?.number).toBe("0911-510119");
    expect(r.sms?.deepLink).toMatch(/^sms:\+886911510119\?body=/);
    expect(r.sms?.deepLink).toContain(encodeURIComponent("ABC-1234"));
  });

  it("includes SMS section in markdown report", () => {
    const r = buildReport(makeCtx());
    expect(r.markdown).toContain("簡訊檢舉");
    expect(r.markdown).toContain("0911-510119");
    expect(r.markdown).toContain("sms:+886911510119");
  });

  it("omits sms artifact for non-traffic categories", () => {
    const r = buildReport(
      makeCtx({
        analysis: {
          category: "environment",
          subject: "亂丟垃圾",
          description: "路邊隨意亂丟垃圾",
          identifiers: { wasteType: "家庭垃圾" },
          confidence: "high",
          evidenceGaps: [],
        },
      }),
    );
    expect(r.sms).toBeUndefined();
    expect(r.markdown).not.toContain("簡訊檢舉");
  });

  it("omits sms artifact when city unknown (no per-city SMS number)", () => {
    const r = buildReport(
      makeCtx({
        address: { full: "某不明地點", source: "user-input" },
      }),
    );
    expect(r.sms).toBeUndefined();
  });

  it("preserves city-specific sms note", () => {
    const r = buildReport(makeCtx());
    expect(r.sms?.note).toMatch(/違規停車/);
  });
});
