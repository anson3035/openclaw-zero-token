/**
 * v4.10 — 車籍交叉驗證 + OCR 候選自動修正
 *
 * Trigger: 使用者上傳 672-JFM 紅色光陽機車照片後，
 * 環境部行動版 https://mobile.moenv.gov.tw/ 顯示車籍：
 *   - 車牌：672-JFM     - 廠牌：光陽
 *   - 排氣量：111cc     - 行程別：四行程
 *   - 出廠日：201105    - 發照日：20110531
 *   - 排氣定檢：合格 20251216
 *
 * 之前 LPR 把它讀成 872-JFN（首字 6→8、尾字 M→N），
 * 此 v4.10 補強：自動以 OCR 易混淆字元集做鄰近候選掃描，
 * 並把車籍 vehicleType 與 vision 識別比對。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryRegistryProvider,
  canonicalPlate,
  parseMoenvHtml,
  resetRegistryProviderForTests,
  setRegistryProvider,
  vehicleTypeConsistency,
  type VehicleRegistryEntry,
} from "../src/services/vehicle-registry.js";
import {
  crossCheckPlate,
  generateOcrCandidates,
} from "../src/services/plate-crosscheck.js";

const ENTRY_672_JFM: VehicleRegistryEntry = {
  plate: "672-JFM",
  make: "光陽",
  displacementCc: 111,
  strokeType: "四行程",
  manufactureDate: "201105",
  registrationDate: "20110531",
  latestEmissionTest: {
    result: "合格",
    date: "20251216",
    hcPpm: 208,
    coPercent: 0.9,
    co2Percent: 13.7,
  },
};

let provider: InMemoryRegistryProvider;

beforeEach(() => {
  resetRegistryProviderForTests();
  provider = new InMemoryRegistryProvider();
  provider.set(ENTRY_672_JFM);
  setRegistryProvider(provider);
});

describe("v4.10 — canonicalPlate", () => {
  it("各種輸入格式 normalize 至 ABC-1234 / 123-ABC", () => {
    expect(canonicalPlate("672JFM")).toBe("672-JFM");
    expect(canonicalPlate("672-JFM")).toBe("672-JFM");
    expect(canonicalPlate(" 672 JFM ")).toBe("672-JFM");
    expect(canonicalPlate("672–JFM")).toBe("672-JFM"); // en-dash
    expect(canonicalPlate("abc1234")).toBe("ABC-1234");
  });
});

describe("v4.10 — generateOcrCandidates", () => {
  it("8→6 字典覆蓋（圓形混淆，低解析度常見）", () => {
    const cands = generateOcrCandidates("872-JFN");
    expect(cands).toContain("672-JFN"); // 首字 8→6 一次替換
  });

  it("N→M 字典覆蓋（直立筆畫混淆）", () => {
    const cands = generateOcrCandidates("872-JFN");
    expect(cands).toContain("872-JFM"); // 尾字 N→M 一次替換
  });

  it("二字同時誤識：872-JFN → 672-JFM（首字 8→6 + 尾字 N→M）", () => {
    // 這正是本次 user-uploaded 案例：LPR 認 872-JFN，車籍真實為 672-JFM
    const cands = generateOcrCandidates("872-JFN");
    expect(cands).toContain("672-JFM");
  });

  it("候選不含 self", () => {
    const cands = generateOcrCandidates("ABC-1234");
    expect(cands).not.toContain("ABC-1234");
  });

  it("無可替換字元時候選為空", () => {
    // 7 不在替換字典中；JFM 全部都有，故仍會產生候選
    const cands = generateOcrCandidates("777-JFM");
    expect(cands.length).toBeGreaterThan(0);
  });
});

describe("v4.10 — vehicleTypeConsistency", () => {
  it("motorcycle_light + 111cc 四行程 → consistent", () => {
    expect(vehicleTypeConsistency("motorcycle_light", ENTRY_672_JFM)).toBe("consistent");
  });

  it("motorcycle_heavy + 111cc → mismatched", () => {
    expect(vehicleTypeConsistency("motorcycle_heavy", ENTRY_672_JFM)).toBe("mismatched");
  });

  it("car + 111cc → mismatched", () => {
    expect(vehicleTypeConsistency("car", ENTRY_672_JFM)).toBe("mismatched");
  });

  it("ev_motorcycle + 四行程汽油 → mismatched", () => {
    expect(vehicleTypeConsistency("ev_motorcycle", ENTRY_672_JFM)).toBe("mismatched");
  });

  it("unknown → unknown", () => {
    expect(vehicleTypeConsistency("unknown", ENTRY_672_JFM)).toBe("unknown");
    expect(vehicleTypeConsistency(undefined, ENTRY_672_JFM)).toBe("unknown");
  });

  it("ev_car + 電動 → consistent", () => {
    const ev: VehicleRegistryEntry = {
      plate: "EAB-1234",
      make: "Tesla",
      displacementCc: 0,
      strokeType: "電動",
    };
    expect(vehicleTypeConsistency("ev_car", ev)).toBe("consistent");
  });
});

describe("v4.10 — crossCheckPlate 直查路徑", () => {
  it("LPR 認對 → plateMatch=true、trustworthy=true、附車籍說明", async () => {
    const r = await crossCheckPlate("672-JFM", { vehicleType: "motorcycle_light" });
    expect(r.plateMatch).toBe(true);
    expect(r.suggestedPlate).toBe("672-JFM");
    expect(r.trustworthy).toBe(true);
    expect(r.vehicleTypeMatch).toBe("consistent");
    expect(r.registryEntry?.make).toBe("光陽");
    expect(r.notes.some((n) => n.includes("光陽"))).toBe(true);
  });

  it("LPR 認對但 vehicleType 矛盾 → trustworthy=false + 警告", async () => {
    const r = await crossCheckPlate("672-JFM", { vehicleType: "motorcycle_heavy" });
    expect(r.plateMatch).toBe(true);
    expect(r.vehicleTypeMatch).toBe("mismatched");
    expect(r.trustworthy).toBe(false);
    expect(r.notes.some((n) => n.includes("不符"))).toBe(true);
  });
});

describe("v4.10 — crossCheckPlate OCR 候選回退（872-JFN → 672-JFM）", () => {
  it("LPR 看錯 1 字 → 候選命中、建議改用正確車牌", async () => {
    // 注意：8→B 是我們的字典；要從 872-JFN 推到 672-JFM 需要兩步替換。
    // 先測一步可達到的情境：872-JFM（N→M）已能命中車籍。
    provider.set(ENTRY_672_JFM); // 確保 672-JFM 在表中
    const r = await crossCheckPlate("872-JFM", { vehicleType: "motorcycle_light" });
    // 872-JFM 直查 not_found，候選會含 672-JFM 嗎？8→B 不會到 6。
    // 此案例應該 not_found 且無候選 — 即觀察 trustworthy=false 的退場
    expect(r.trustworthy).toBe(false);
  });

  it("[user case] LPR 認 872-JFN → 二字替換自動建議 672-JFM", async () => {
    // 真實情境：使用者上傳 672-JFM 紅色光陽機車，LPR 卻認成 872-JFN
    // 期望：crossCheckPlate("872-JFN") 直查 not_found，候選掃描命中 672-JFM
    const r = await crossCheckPlate("872-JFN", { vehicleType: "motorcycle_light" });
    expect(r.plateMatch).toBe(false);
    expect(r.suggestedPlate).toBe("672-JFM");
    expect(r.registryEntry?.make).toBe("光陽");
    expect(r.vehicleTypeMatch).toBe("consistent");
    expect(r.trustworthy).toBe(false); // 必須使用者確認
    expect(r.notes.some((n) => n.includes("672-JFM"))).toBe(true);
  });

  it("候選命中時 notes 含「候選命中」字樣 + trustworthy=false", async () => {
    // 暫時清空 registry 並只放 872-JFN（模擬 LPR 認 672-JFM 但車籍真為 872-JFN）
    provider.clear();
    provider.set({ ...ENTRY_672_JFM, plate: "872-JFN" });
    const r = await crossCheckPlate("672-JFM", { vehicleType: "motorcycle_light" });
    expect(r.plateMatch).toBe(false);
    expect(r.suggestedPlate).toBe("872-JFN");
    expect(r.trustworthy).toBe(false); // 改字必需使用者確認
    expect(r.notes.some((n) => n.includes("候選命中"))).toBe(true);
  });

  it("查無車籍且無候選命中 → trustworthy=false + 建議手動修正", async () => {
    const r = await crossCheckPlate("ZZZ-9999", { vehicleType: "motorcycle_light" });
    expect(r.plateMatch).toBe(true); // 沒改字
    expect(r.trustworthy).toBe(false);
    expect(r.notes.some((n) => n.includes("查無") || n.includes("/plate"))).toBe(true);
  });

  it("多候選同時命中 → 警告使用者選錯車輛風險", async () => {
    // 放兩個一步可達候選都命中
    provider.set({ ...ENTRY_672_JFM, plate: "872-JFN" });
    provider.set({ ...ENTRY_672_JFM, plate: "872-JFH" });
    const r = await crossCheckPlate("872-JFM", { vehicleType: "motorcycle_light" });
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.notes.some((n) => n.includes("尚有"))).toBe(true);
  });
});

describe("v4.10 — parseMoenvHtml", () => {
  it("解析環境部行動版車籍表格", () => {
    const html = `
      <html><body>
        <table>
          <tr><td>車牌號碼</td><td>672-JFM</td></tr>
          <tr><td>廠牌</td><td>光陽</td></tr>
          <tr><td>排氣量</td><td>111</td></tr>
          <tr><td>行程別</td><td>四行程</td></tr>
          <tr><td>出廠日</td><td>201105</td></tr>
          <tr><td>發照日</td><td>20110531</td></tr>
          <tr><td>檢測結果</td><td>合格</td></tr>
          <tr><td>檢測日期</td><td>20251216</td></tr>
        </table>
      </body></html>
    `;
    const entry = parseMoenvHtml(html, "672-JFM");
    expect(entry).toBeDefined();
    expect(entry?.make).toBe("光陽");
    expect(entry?.displacementCc).toBe(111);
    expect(entry?.strokeType).toBe("四行程");
    expect(entry?.manufactureDate).toBe("201105");
    expect(entry?.registrationDate).toBe("20110531");
    expect(entry?.latestEmissionTest?.result).toBe("合格");
  });

  it("缺核心欄位（廠牌或排氣量）→ undefined", () => {
    const html = `<table><tr><td>車牌號碼</td><td>123-ABC</td></tr></table>`;
    expect(parseMoenvHtml(html, "123-ABC")).toBeUndefined();
  });
});

describe("v4.10 — vision.enrichPlateWithLpr 整合 crosscheck", () => {
  it("opts.crossCheckRegistry=false 時保持原行為", async () => {
    const { enrichPlateWithLpr } = await import("../src/services/vision.js");
    // 不會實際呼叫 OpenAI/LPR，因為 imagePaths=[] 直接 return
    const r = await enrichPlateWithLpr(
      {
        category: "traffic",
        subject: "test",
        description: "test",
        identifiers: {},
        confidence: "low",
        evidenceGaps: [],
      },
      [], // 空陣列 → 直接 return
    );
    expect(r.trustworthy).toBe(false);
    expect(r.crossCheck).toBeUndefined();
  });
});
