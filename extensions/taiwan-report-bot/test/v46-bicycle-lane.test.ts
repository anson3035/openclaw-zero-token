import { describe, expect, it } from "vitest";
import {
  matchLegalCitations,
  matchLegalCitationsMulti,
} from "../src/data/legal-rules.js";

describe("v4.6 — 自行車道 / 慢車道占用規則", () => {
  it("「占用自行車道」命中專屬規則", () => {
    const cs = matchLegalCitations("traffic", "Tesla 占用自行車道停車");
    expect(
      cs.some((c) => c.shortLabel === "違規停車（自行車道/慢車道）"),
    ).toBe(true);
  });

  it("「慢車道」描述亦命中", () => {
    const cs = matchLegalCitations("traffic", "汽車停在慢車道上");
    expect(
      cs.some((c) => c.shortLabel === "違規停車（自行車道/慢車道）"),
    ).toBe(true);
  });

  it("「機慢車優先道」亦命中", () => {
    const cs = matchLegalCitations("traffic", "車輛停在機慢車優先道");
    expect(
      cs.some((c) => c.shortLabel === "違規停車（自行車道/慢車道）"),
    ).toBe(true);
  });

  it("「綠色車道」亦命中", () => {
    const cs = matchLegalCitations("traffic", "停放於綠色車道上");
    expect(
      cs.some((c) => c.shortLabel === "違規停車（自行車道/慢車道）"),
    ).toBe(true);
  });

  it("sceneType=bicycle_lane 自動觸發命中（即使描述無關鍵字）", () => {
    const cs = matchLegalCitations(
      "traffic",
      "白色 Tesla 違停",
      "bicycle_lane",
    );
    expect(
      cs.some((c) => c.shortLabel === "違規停車（自行車道/慢車道）"),
    ).toBe(true);
  });

  it("規則屬 instantaneous + owner liability", () => {
    const cs = matchLegalCitations("traffic", "自行車道停車");
    const rule = cs.find((c) => c.shortLabel === "違規停車（自行車道/慢車道）");
    expect(rule?.evidenceMode).toBe("instantaneous");
    expect(rule?.liabilityTarget).toBe("owner");
  });

  it("自行車道 + 紅線同時違規（multi-citation）", () => {
    const cs = matchLegalCitationsMulti(
      "traffic",
      "Tesla 停在自行車道上，鄰近紅線",
      "bicycle_lane",
    );
    expect(cs.some((c) => c.shortLabel?.includes("自行車道"))).toBe(true);
    expect(cs.some((c) => c.shortLabel?.includes("紅線"))).toBe(true);
  });

  it("一般紅線違停不會誤觸自行車道規則", () => {
    const cs = matchLegalCitations("traffic", "違停紅線", "red_line");
    expect(
      cs.every((c) => !c.shortLabel?.includes("自行車道")),
    ).toBe(true);
  });
});
