/**
 * v4.10 demo — BMW 320i (E46) 紅線違停案例
 *
 * User uploads (2026-06-15 07:47:37 ~ 07:47:49，12 秒內三張)：
 *   IMG_2906  車尾特寫，車牌 8157-DG，紅色路緣清晰
 *   IMG_2907  車頭 45°，紅線路旁停放
 *   IMG_2908  車頭 + 背景：前方兩支三角錐占位、YouBike 站
 *
 * 期望驗證：
 *   1. cross-check 8157-DG → registry 命中 BMW 車籍且 vehicleType=car 一致
 *   2. OCR 潛在誤識 8157↔8J57 之替代候選
 *   3. legal-rules 命中 §56 I② 紅線（instantaneous 單張足夠）
 *   4. legal-rules 命中 §82-1 三角錐占道（v4.8）
 *   5. compliance gate：紅線 instantaneous → 3 張照片綽綽有餘、ok=true
 */
import {
  InMemoryRegistryProvider,
  setRegistryProvider,
  resetRegistryProviderForTests,
} from "../src/services/vehicle-registry.js";
import { crossCheckPlate } from "../src/services/plate-crosscheck.js";
import { matchLegalCitationsMulti } from "../src/data/legal-rules.js";
import { checkCompliance } from "../src/services/compliance.js";
import { buildReport } from "../src/services/report.js";
import type { ReportContext } from "../src/types.js";

async function main(): Promise<void> {
  resetRegistryProviderForTests();
  const reg = new InMemoryRegistryProvider();
  // 註冊真實車籍（示範：BMW 320i / E46 / 2001cc / 四行程）
  reg.set({
    plate: "8157-DG",
    make: "BMW",
    displacementCc: 2171, // 320i 6-cyl
    strokeType: "四行程",
    manufactureDate: "20040815",
    registrationDate: "20040930",
    latestEmissionTest: {
      result: "合格",
      date: "20260415",
    },
  });
  setRegistryProvider(reg);

  console.log("══════════════════════════════════════════════════════════════");
  console.log("v4.10 demo — BMW 320i 8157-DG @ 紅線 (2026-06-15 07:47:37)");
  console.log("══════════════════════════════════════════════════════════════\n");

  // ── 1) LPR 假設兩種可能：正確 8157-DG，或看錯 8J57-DG ──
  console.log("▶ 情境 A：LPR 認對 8157-DG");
  const xcA = await crossCheckPlate("8157-DG", { vehicleType: "car" });
  console.log(`  plateMatch=${xcA.plateMatch}  trustworthy=${xcA.trustworthy}  vehicleTypeMatch=${xcA.vehicleTypeMatch}`);
  console.log(`  registryEntry = ${xcA.registryEntry?.make} ${xcA.registryEntry?.displacementCc}cc`);
  for (const n of xcA.notes) console.log(`  - ${n}`);
  console.log("");

  console.log("▶ 情境 B：LPR 看錯 8J57-DG（1↔J OCR 混淆）");
  const xcB = await crossCheckPlate("8J57-DG", { vehicleType: "car" });
  console.log(`  suggestedPlate=${xcB.suggestedPlate}  trustworthy=${xcB.trustworthy}`);
  for (const n of xcB.notes) console.log(`  - ${n}`);
  console.log("");

  // ── 2) 法條比對（採用建議車牌，情境 B 建議 8157-DG） ──
  const usedPlate = xcB.suggestedPlate;
  const description =
    "銀色 BMW 320i 汽車違停紅線，車頭前方擺放兩支三角錐占位，鄰近 YouBike 站";
  console.log(`▶ 採用 ${usedPlate} 進 legal-rules（description="${description}"）\n`);

  const citations = matchLegalCitationsMulti(
    "traffic",
    description,
    "red_line",
  );
  console.log(`▶ matchLegalCitationsMulti 命中 ${citations.length} 條：`);
  for (const c of citations) {
    const tag = c.reportableByCitizen === false ? "❌ 限警察" : "✅ 民眾可舉";
    const mode =
      c.evidenceMode === "instantaneous"
        ? "單張即可"
        : c.evidenceMode === "continuous"
          ? "需 ≥2 張、≥3 分鐘"
          : "動態違規";
    console.log(`  - ${c.statute} ${c.article}（${c.shortLabel ?? ""}）  ${tag}  採證：${mode}`);
    console.log(`    處罰：${c.penalty}`);
    if (c.reward?.available) console.log(`    💰 獎金：${c.reward.estimateRange}`);
  }
  console.log("");

  // ── 3) 三張照片跨 12 秒 → compliance gate ──
  const t0 = new Date(2026, 5, 15, 7, 47, 37); // 2026-06-15 07:47:37
  const t1 = new Date(2026, 5, 15, 7, 47, 47);
  const t2 = new Date(2026, 5, 15, 7, 47, 49);

  const ctx: ReportContext = {
    evidence: [
      {
        filePath: "/uploads/IMG_2906.jpeg",
        mimeType: "image/jpeg",
        sha256: "a".repeat(64),
        source: "telegram",
        sourceMessageId: 1,
        sourceChatId: 1,
        capturedAt: t0,
      },
      {
        filePath: "/uploads/IMG_2907.jpeg",
        mimeType: "image/jpeg",
        sha256: "b".repeat(64),
        source: "telegram",
        sourceMessageId: 2,
        sourceChatId: 1,
        capturedAt: t1,
      },
      {
        filePath: "/uploads/IMG_2908.jpeg",
        mimeType: "image/jpeg",
        sha256: "c".repeat(64),
        source: "telegram",
        sourceMessageId: 3,
        sourceChatId: 1,
        capturedAt: t2,
      },
    ],
    analysis: {
      category: "traffic",
      subject: `BMW 320i ${usedPlate}`,
      description,
      identifiers: { licensePlate: usedPlate },
      confidence: "high",
      evidenceGaps: [],
      vehicleType: "car",
      sceneType: "red_line",
      signTexts: [],
    },
    address: {
      full: "台北市某區某路一段",
      city: "台北市",
      district: "某區",
      source: "user-input",
    },
    reporter: { name: "王小明", contact: "0912-345678" },
    plateConfirmed: xcB.trustworthy, // false — 需使用者確認車牌
    plateRequiresVerification: !xcB.trustworthy,
  };

  const compliance = checkCompliance(ctx, citations);
  console.log(`▶ Compliance gate：ok=${compliance.ok}`);
  for (const issue of compliance.issues) console.log(`  ${issue}`);
  console.log("");

  // ── 4) buildReport ──
  const artifact = buildReport(ctx);
  console.log(`▶ buildReport：`);
  console.log(`  trackingId  = ${artifact.trackingId}`);
  console.log(`  recipients  = ${artifact.recipients.join(", ")}`);
  console.log(`  citations   = ${artifact.legalCitations.length}`);
  console.log(`  emailSubject= ${artifact.emailSubject}`);
}

main().catch((e) => {
  console.error("demo failed:", e);
  process.exit(1);
});
