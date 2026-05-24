import { describe, expect, it } from "vitest";
import { parseUserAddress } from "../src/services/geocoding.js";

describe("parseUserAddress", () => {
  it("extracts Taipei city from user-supplied address", () => {
    const result = parseUserAddress("台北市中正區忠孝東路一段1號");
    expect(result.city).toBe("台北市");
    expect(result.source).toBe("user-input");
  });

  it("normalizes 臺 form to 台 form", () => {
    const result = parseUserAddress("臺中市西區美村路一段100號");
    expect(result.city).toBe("台中市");
  });

  it("returns no city when input has none", () => {
    const result = parseUserAddress("某條街100號");
    expect(result.city).toBeUndefined();
    expect(result.full).toBe("某條街100號");
  });
});
