import { describe, expect, it } from "vitest";
import { categoryLabel, listTrafficRules, matchLegalCitations } from "../src/data/legal-rules.js";

describe("legal-rules — traffic", () => {
  it("matches red-line parking (instantaneous, citizen reportable)", () => {
    const cs = matchLegalCitations("traffic", "汽車違停於紅線旁");
    expect(cs.some((c) => c.article.match(/56.*第 1 項 第 1 款/))).toBe(true);
    expect(cs[0]?.reportableByCitizen).toBe(true);
    expect(cs[0]?.evidenceMode).toBe("instantaneous");
  });

  it("matches sidewalk parking (instantaneous)", () => {
    const cs = matchLegalCitations("traffic", "Toyota Wish 佔用人行道停車");
    expect(cs.some((c) => c.shortLabel === "違規停車（人行道）")).toBe(true);
  });

  it("matches arcade (騎樓) parking (instantaneous)", () => {
    const cs = matchLegalCitations("traffic", "機車違停於騎樓");
    expect(cs.some((c) => c.shortLabel === "違規停車（騎樓）")).toBe(true);
  });

  it("matches fire-hydrant parking (instantaneous)", () => {
    const cs = matchLegalCitations("traffic", "汽車停於消防栓 3 公尺內");
    expect(cs.some((c) => c.shortLabel?.includes("消防"))).toBe(true);
  });

  it("matches yellow line as continuous", () => {
    const cs = matchLegalCitations("traffic", "白色轎車違停於黃線");
    expect(cs.some((c) => c.evidenceMode === "continuous")).toBe(true);
  });

  it("matches disabled-parking-spot occupation", () => {
    const cs = matchLegalCitations("traffic", "汽車違停於身心障礙專用車位");
    expect(cs.some((c) => c.shortLabel?.includes("身心障礙"))).toBe(true);
    expect(cs[0]?.reportableByCitizen).toBe(true);
  });

  it("matches red light running (moving, citizen reportable)", () => {
    const cs = matchLegalCitations("traffic", "機車闖紅燈通過路口");
    expect(cs.some((c) => c.shortLabel === "闖紅燈")).toBe(true);
    expect(cs[0]?.evidenceMode).toBe("moving");
    expect(cs[0]?.reportableByCitizen).toBe(true);
  });

  it("matches yielding-to-pedestrian violation", () => {
    const cs = matchLegalCitations("traffic", "汽車未禮讓行人通過斑馬線");
    expect(cs.some((c) => c.shortLabel?.includes("禮讓"))).toBe(true);
  });

  it("matches dangerous/snake driving", () => {
    const cs = matchLegalCitations("traffic", "重機蛇行高速危險駕駛");
    expect(cs.some((c) => c.shortLabel?.includes("蛇行"))).toBe(true);
  });

  it("matches illegal U-turn", () => {
    const cs = matchLegalCitations("traffic", "汽車於禁止迴轉路段違規迴轉");
    expect(cs.some((c) => c.shortLabel === "違規迴轉")).toBe(true);
  });

  it("flags overspeed as NOT citizen-reportable", () => {
    const cs = matchLegalCitations("traffic", "汽車超速行駛");
    const overspeed = cs.find((c) => c.shortLabel?.includes("超速"));
    expect(overspeed).toBeDefined();
    expect(overspeed?.reportableByCitizen).toBe(false);
  });

  it("flags no-helmet as NOT citizen-reportable", () => {
    const cs = matchLegalCitations("traffic", "機車駕駛未戴安全帽");
    expect(cs.some((c) => c.reportableByCitizen === false)).toBe(true);
  });

  it("flags DUI as NOT citizen-reportable", () => {
    const cs = matchLegalCitations("traffic", "疑似酒駕");
    const dui = cs.find((c) => c.shortLabel?.includes("酒"));
    expect(dui?.reportableByCitizen).toBe(false);
  });

  it("generic 違停 falls back to continuous mode (conservative)", () => {
    const cs = matchLegalCitations("traffic", "汽車違停於路邊");
    expect(cs.some((c) => c.evidenceMode === "continuous")).toBe(true);
  });

  it("all rules carry reportable + evidenceMode metadata", () => {
    for (const c of listTrafficRules()) {
      expect(typeof c.reportableByCitizen).toBe("boolean");
      expect(["instantaneous", "continuous", "moving"]).toContain(c.evidenceMode);
    }
  });
});

describe("legal-rules — environment", () => {
  it("matches waste dumping", () => {
    const cs = matchLegalCitations("environment", "路邊隨意亂丟垃圾");
    expect(cs[0]?.statute).toBe("廢棄物清理法");
  });

  it("matches vehicle exhaust", () => {
    const cs = matchLegalCitations("environment", "機車排氣明顯超標冒黑煙");
    expect(cs.some((c) => c.shortLabel?.includes("排氣"))).toBe(true);
  });

  it("matches restaurant smoke", () => {
    const cs = matchLegalCitations("environment", "餐廳油煙未處理直接排放");
    expect(cs.some((c) => c.shortLabel?.includes("油煙"))).toBe(true);
  });
});

describe("legal-rules — building", () => {
  it("matches rooftop unauthorized construction", () => {
    const cs = matchLegalCitations("building", "頂樓加蓋鐵皮屋未經許可");
    expect(cs[0]?.statute).toBe("建築法");
  });
});

describe("legal-rules — condominium", () => {
  it("matches public-corridor occupation", () => {
    const cs = matchLegalCitations("condominium", "佔用樓梯間堆置雜物");
    expect(cs[0]?.statute).toBe("公寓大廈管理條例");
  });

  it("flags condominium rules as NOT police-initiated (must go through 管委會 / 縣市府)", () => {
    const cs = matchLegalCitations("condominium", "佔用走廊堆置雜物");
    expect(cs.some((c) => c.policeInitiated === false)).toBe(true);
  });
});

describe("categoryLabel", () => {
  it("provides Traditional Chinese category labels", () => {
    expect(categoryLabel("traffic")).toBe("交通違規");
    expect(categoryLabel("environment")).toBe("環保違規");
    expect(categoryLabel("building")).toBe("建築違規");
    expect(categoryLabel("condominium")).toBe("公寓大廈違規");
  });
});
