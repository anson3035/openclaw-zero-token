import { describe, expect, it } from "vitest";
import { categoryLabel, matchLegalCitations } from "../src/data/legal-rules.js";

describe("legal-rules", () => {
  it("matches traffic illegal parking", () => {
    const citations = matchLegalCitations("traffic", "汽車違停於紅線旁");
    expect(citations[0]?.statute).toBe("道路交通管理處罰條例");
    expect(citations[0]?.article).toMatch(/56/);
  });

  it("matches red light running", () => {
    const citations = matchLegalCitations("traffic", "機車闖紅燈通過路口");
    expect(citations[0]?.article).toMatch(/53/);
  });

  it("matches waste dumping", () => {
    const citations = matchLegalCitations("environment", "路邊隨意亂丟垃圾");
    expect(citations[0]?.statute).toBe("廢棄物清理法");
  });

  it("matches unauthorized rooftop construction", () => {
    const citations = matchLegalCitations("building", "頂樓加蓋鐵皮屋");
    expect(citations[0]?.statute).toBe("建築法");
  });

  it("matches public corridor occupation", () => {
    const citations = matchLegalCitations("condominium", "佔用走廊堆放雜物");
    expect(citations[0]?.statute).toBe("公寓大廈管理條例");
  });

  it("falls back to first rule when no pattern matches", () => {
    const citations = matchLegalCitations("traffic", "完全無關內容");
    expect(citations.length).toBeGreaterThan(0);
  });

  it("provides Traditional Chinese category labels", () => {
    expect(categoryLabel("traffic")).toBe("交通違規");
    expect(categoryLabel("environment")).toBe("環保違規");
    expect(categoryLabel("building")).toBe("建築違規");
    expect(categoryLabel("condominium")).toBe("公寓大廈違規");
  });
});
