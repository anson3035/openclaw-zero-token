import { describe, expect, it } from "vitest";
import {
  hasReward,
  matchLegalCitations,
} from "../src/data/legal-rules.js";
import { computeStatuteOfLimitations } from "../src/services/statute-of-limitations.js";

describe("舉發時效（道交 §90 第 1 項）", () => {
  it("交通違規 90 日內仍可舉發", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 30); // 30 天前
    const r = computeStatuteOfLimitations("traffic", recent);
    expect(r.totalDays).toBe(90);
    expect(r.valid).toBe(true);
    expect(r.remainingDays).toBeGreaterThanOrEqual(59);
    expect(r.remainingDays).toBeLessThanOrEqual(61);
  });

  it("交通違規逾 90 日不得舉發", () => {
    const old = new Date();
    old.setDate(old.getDate() - 100); // 100 天前
    const r = computeStatuteOfLimitations("traffic", old);
    expect(r.valid).toBe(false);
    expect(r.remainingDays).toBeLessThan(0);
  });

  it("環保違規時效 365 日", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 200);
    const r = computeStatuteOfLimitations("environment", recent);
    expect(r.totalDays).toBe(365);
    expect(r.valid).toBe(true);
  });

  it("建築違規無時效（持續違規狀態）", () => {
    const longAgo = new Date("2020-01-01");
    const r = computeStatuteOfLimitations("building", longAgo);
    expect(r.totalDays).toBe(0);
    expect(r.valid).toBe(true);
  });

  it("公寓大廈違規無時效", () => {
    const longAgo = new Date("2018-01-01");
    const r = computeStatuteOfLimitations("condominium", longAgo);
    expect(r.valid).toBe(true);
  });
});

describe("裁罰主體（道交 §85）", () => {
  it("違停類自動標 owner（駕駛不在場）", () => {
    const cs = matchLegalCitations("traffic", "汽車違停於紅線");
    const c = cs.find((c) => c.shortLabel?.includes("紅線"));
    expect(c?.liabilityTarget).toBe("owner");
  });

  it("人行道違停亦為 owner", () => {
    const cs = matchLegalCitations("traffic", "佔用人行道停車");
    const c = cs.find((c) => c.shortLabel?.includes("人行道"));
    expect(c?.liabilityTarget).toBe("owner");
  });

  it("闖紅燈標 driver（駕駛在場）", () => {
    const cs = matchLegalCitations("traffic", "機車闖紅燈");
    const c = cs.find((c) => c.shortLabel === "闖紅燈");
    expect(c?.liabilityTarget).toBe("driver");
  });

  it("未禮讓行人標 driver", () => {
    const cs = matchLegalCitations("traffic", "汽車未禮讓行人通過斑馬線");
    const c = cs.find((c) => c.shortLabel?.includes("禮讓"));
    expect(c?.liabilityTarget).toBe("driver");
  });

  it("酒駕標 driver", () => {
    const cs = matchLegalCitations("traffic", "疑似酒後駕車");
    const c = cs.find((c) => c.shortLabel?.includes("酒"));
    expect(c?.liabilityTarget).toBe("driver");
  });
});

describe("刑罰優先（行政罰法 §26）", () => {
  it("棄置有害事業廢棄物 → 刑法 §190-1 流放毒物罪", () => {
    const cs = matchLegalCitations("environment", "山區棄置有害事業廢棄物");
    const c = cs.find((c) => c.shortLabel?.includes("有害"));
    expect(c?.criminalAlternative).toBeDefined();
    expect(c?.criminalAlternative?.statute).toBe("中華民國刑法");
    expect(c?.criminalAlternative?.article).toContain("190-1");
  });

  it("酒駕 → 刑法 §185-3", () => {
    const cs = matchLegalCitations("traffic", "酒後駕車");
    const c = cs.find((c) => c.criminalAlternative);
    expect(c?.criminalAlternative?.article).toContain("185-3");
  });

  it("蛇行 → 刑法 §185", () => {
    const cs = matchLegalCitations("traffic", "重型機車蛇行高速");
    const c = cs.find((c) => c.criminalAlternative);
    expect(c?.criminalAlternative?.article).toContain("185");
  });

  it("一般違停無刑罰替代", () => {
    const cs = matchLegalCitations("traffic", "違停紅線");
    expect(cs.every((c) => !c.criminalAlternative)).toBe(true);
  });
});

describe("時效自動標註", () => {
  it("道交條例違規自動帶 90 日時效", () => {
    const cs = matchLegalCitations("traffic", "違停紅線");
    expect(cs[0]?.statuteOfLimitationsDays).toBe(90);
  });

  it("環保違規不自動帶 90 日時效", () => {
    const cs = matchLegalCitations("environment", "亂丟垃圾");
    expect(cs[0]?.statuteOfLimitationsDays).toBeUndefined();
  });
});

describe("獎金狀態未受影響", () => {
  it("環保獎金仍正確標註", () => {
    expect(hasReward(matchLegalCitations("environment", "亂丟垃圾"))).toBe(true);
  });

  it("交通仍無獎金", () => {
    expect(hasReward(matchLegalCitations("traffic", "違停紅線"))).toBe(false);
  });
});
