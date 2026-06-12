/**
 * 一次性 demo 腳本 — 把 IMG_2833 + IMG_2834（紅色光陽 672-JFM）的場景
 * 跑過整條 v4.10 pipeline，列印每一步 trace。
 *
 * 模擬：
 *   - vision 模型回傳 vehicleType=motorcycle_light, plate=「872-JFN」（OCR 失誤）
 *   - registry 內有 672-JFM 之車籍（光陽 111cc 四行程）
 *   - cross-check 應自動建議改用 672-JFM 並標記 trustworthy=false
 *
 * 執行：node --import tsx scripts/demo-672-jfm.ts
 */
import {
  InMemoryRegistryProvider,
  setRegistryProvider,
  resetRegistryProviderForTests,
} from "../src/services/vehicle-registry.js";
import { crossCheckPlate } from "../src/services/plate-crosscheck.js";
import { matchLegalCitationsMulti } from "../src/data/legal-rules.js";
import { checkCompliance } from "../src/services/compliance.js";
import type { ReportContext } from "../src/types.js";

async function main(): Promise<void> {
  // 1) 設置 in-memory registry — 注入真實車籍
  resetRegistryProviderForTests();
  const reg = new InMemoryRegistryProvider();
  reg.set({
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
  });
  setRegistryProvider(reg);

  console.log("══════════════════════════════════════════════════════════════");
  console.log("v4.10 demo — IMG_2833 + IMG_2834 (紅色光陽機車)");
  console.log("══════════════════════════════════════════════════════════════\n");

  // 2) 模擬 LPR / vision 模型輸出
  const lprPlate = "872-JFN"; // OCR 兩字看錯
  const visionVehicleType = "motorcycle_light";
  console.log(`▶ Vision 模型回傳：plate="${lprPlate}", vehicleType=${visionVehicleType}`);
  console.log(`  （注意：實際車牌應為 672-JFM — 6→8、M→N 兩字 OCR 失誤）\n`);

  // 3) 跑 cross-check
  const xc = await crossCheckPlate(lprPlate, { vehicleType: visionVehicleType });
  console.log(`▶ crossCheckPlate 結果：`);
  console.log(`  lprPlate         = ${xc.lprPlate}`);
  console.log(`  suggestedPlate   = ${xc.suggestedPlate}`);
  console.log(`  plateMatch       = ${xc.plateMatch}`);
  console.log(`  trustworthy      = ${xc.trustworthy}`);
  console.log(`  vehicleTypeMatch = ${xc.vehicleTypeMatch}`);
  if (xc.registryEntry) {
    const e = xc.registryEntry;
    console.log(`  registryEntry    = ${e.make} ${e.displacementCc}cc / ${e.strokeType}`);
    console.log(`                     發照 ${e.registrationDate}，最近排氣定檢：${e.latestEmissionTest?.result}`);
  }
  console.log(`  notes:`);
  for (const n of xc.notes) console.log(`    - ${n}`);
  console.log("");

  // 4) 用「建議車牌」走後續 pipeline
  const correctedPlate = xc.suggestedPlate;
  console.log(`▶ 採用建議車牌 ${correctedPlate} 進入 legal-rules 比對\n`);

  const description =
    "紅色光陽 Vespa 風機車駕駛人右手持菸騎乘，未戴安全帽，行駛中";
  const citations = matchLegalCitationsMulti("traffic", description, undefined);
  console.log(`▶ matchLegalCitationsMulti 命中 ${citations.length} 條：`);
  for (const c of citations) {
    const tag = c.reportableByCitizen === false ? "❌ 限警察" : "✅ 民眾可舉";
    console.log(`  - ${c.statute} ${c.article}（${c.shortLabel ?? ""}）  ${tag}`);
    console.log(`    處罰：${c.penalty}`);
    if (c.reward?.available) {
      console.log(`    💰 獎金：${c.reward.estimateRange}（${c.reward.authority}）`);
    }
  }
  console.log("");

  // 5) Compliance gate
  const ctx: ReportContext = {
    evidence: [
      {
        filePath: "/uploads/IMG_2833.jpeg",
        mimeType: "image/jpeg",
        sha256: "demo".padEnd(64, "0"),
        source: "telegram",
        sourceMessageId: 1,
        sourceChatId: 1,
        capturedAt: new Date(),
      },
      {
        filePath: "/uploads/IMG_2834.jpeg",
        mimeType: "image/jpeg",
        sha256: "demo".padEnd(64, "1"),
        source: "telegram",
        sourceMessageId: 2,
        sourceChatId: 1,
        capturedAt: new Date(Date.now() + 5 * 1000),
      },
    ],
    analysis: {
      category: "traffic",
      subject: `光陽機車 ${correctedPlate}`,
      description,
      identifiers: { licensePlate: correctedPlate },
      confidence: "high",
      evidenceGaps: ["車籍交叉驗證提示：LPR 認 872-JFN，已自動修正為 672-JFM"],
      vehicleType: "motorcycle_light",
    },
    address: {
      full: "高雄市某區某街",
      city: "高雄市",
      source: "user-input",
    },
    reporter: { name: "王小明", contact: "0912-345678" },
    plateConfirmed: false,
    plateRequiresVerification: !xc.trustworthy,
  };
  const compliance = checkCompliance(ctx, citations);
  console.log(`▶ Compliance gate：ok=${compliance.ok}`);
  for (const issue of compliance.issues) console.log(`  ${issue}`);
}

main().catch((e) => {
  console.error("demo failed:", e);
  process.exit(1);
});
