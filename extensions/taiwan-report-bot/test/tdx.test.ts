import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "0000000000:test_token_long_enough";
  process.env.OPENAI_API_KEY = "sk-test-long-enough-key";
});

describe("TDX helpers", () => {
  it("maps Traditional Chinese city names to TDX city codes (six metros)", async () => {
    const { tdxCityCode } = await import("../src/services/tdx.js");
    expect(tdxCityCode("台北市")).toBe("Taipei");
    expect(tdxCityCode("新北市")).toBe("NewTaipei");
    expect(tdxCityCode("桃園市")).toBe("Taoyuan");
    expect(tdxCityCode("台中市")).toBe("Taichung");
    expect(tdxCityCode("台南市")).toBe("Tainan");
    expect(tdxCityCode("高雄市")).toBe("Kaohsiung");
  });

  it("normalises 臺 → 台 before mapping", async () => {
    const { tdxCityCode } = await import("../src/services/tdx.js");
    expect(tdxCityCode("臺北市")).toBe("Taipei");
    expect(tdxCityCode("臺中市")).toBe("Taichung");
    expect(tdxCityCode("臺東縣")).toBe("TaitungCounty");
  });

  it("maps the rest of Taiwan's cities/counties", async () => {
    const { tdxCityCode } = await import("../src/services/tdx.js");
    expect(tdxCityCode("基隆市")).toBe("Keelung");
    expect(tdxCityCode("新竹市")).toBe("HsinchuCity");
    expect(tdxCityCode("新竹縣")).toBe("HsinchuCounty");
    expect(tdxCityCode("花蓮縣")).toBe("HualienCounty");
    expect(tdxCityCode("金門縣")).toBe("KinmenCounty");
  });

  it("returns undefined for unknown city names", async () => {
    const { tdxCityCode } = await import("../src/services/tdx.js");
    expect(tdxCityCode("東京都")).toBeUndefined();
    expect(tdxCityCode("")).toBeUndefined();
  });

  it("haversineMeters computes correct distance (Taipei 101 ↔ Songshan Airport)", async () => {
    const { _exposedForTests } = await import("../src/services/tdx.js");
    // Taipei 101: 25.0330, 121.5645
    // 松山機場: 25.0697, 121.5520
    // Real distance ≈ 4150 m
    const d = _exposedForTests.haversineMeters(25.033, 121.5645, 25.0697, 121.552);
    expect(d).toBeGreaterThan(4000);
    expect(d).toBeLessThan(4300);
  });

  it("haversineMeters returns ~0 for identical points", async () => {
    const { _exposedForTests } = await import("../src/services/tdx.js");
    expect(_exposedForTests.haversineMeters(25.0, 121.5, 25.0, 121.5)).toBe(0);
  });

  it("haversineMeters returns ~10 m for points 10 m apart (~0.00009° lat)", async () => {
    const { _exposedForTests } = await import("../src/services/tdx.js");
    const d = _exposedForTests.haversineMeters(25.0, 121.5, 25.00009, 121.5);
    expect(d).toBeGreaterThan(9);
    expect(d).toBeLessThan(11);
  });
});
