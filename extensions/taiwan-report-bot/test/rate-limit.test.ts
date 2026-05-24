import { beforeEach, describe, expect, it } from "vitest";
import {
  rateLimitMessage,
  resetForTests,
  tryConsumeAnalysis,
  tryConsumeSend,
} from "../src/services/rate-limit.js";

describe("rate-limit", () => {
  beforeEach(() => resetForTests());

  it("allows analysis up to capacity (5) then blocks", () => {
    for (let i = 0; i < 5; i++) {
      expect(tryConsumeAnalysis(42)).toBe(true);
    }
    expect(tryConsumeAnalysis(42)).toBe(false);
  });

  it("separates buckets per user id", () => {
    for (let i = 0; i < 5; i++) tryConsumeAnalysis(1);
    expect(tryConsumeAnalysis(1)).toBe(false);
    expect(tryConsumeAnalysis(2)).toBe(true);
  });

  it("uses independent buckets for analysis vs send", () => {
    for (let i = 0; i < 5; i++) tryConsumeAnalysis(7);
    expect(tryConsumeAnalysis(7)).toBe(false);
    expect(tryConsumeSend(7)).toBe(true);
  });

  it("send capacity is smaller (3)", () => {
    for (let i = 0; i < 3; i++) {
      expect(tryConsumeSend(9)).toBe(true);
    }
    expect(tryConsumeSend(9)).toBe(false);
  });

  it("emits localized message", () => {
    expect(rateLimitMessage("analysis")).toContain("分析");
    expect(rateLimitMessage("send")).toContain("寄送");
  });
});
