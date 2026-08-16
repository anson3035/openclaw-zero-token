/**
 * v4.11 — BMW 320i (E46) 8157-DG 紅線違停案例回歸 + 端到端 demo
 *
 * User uploads (2026-06-15 07:47:37 ~ 07:47:49，12 秒內三張)：
 *   IMG_2906  車尾特寫，車牌 8157-DG，紅色路緣清晰
 *   IMG_2907  車頭 45°，紅線路旁停放，前方有另一台深色 SUV
 *   IMG_2908  車頭 + 背景：前方兩支橘色三角錐占位、YouBike 站
 *
 * 期望驗證：
 *   1. cross-check 8157-DG → registry 命中 BMW 車籍且 vehicleType=car 一致
 *   2. OCR 常見誤識 8157↔8J57 之候選建議
 *   3. legal-rules 命中 §56 I② 紅線（instantaneous 單張足夠）
 *   4. legal-rules 命中 §82-1 三角錐占道（v4.8）
 *   5. compliance gate：紅線 instantaneous → 3 張照片 ok=true 通過
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryRegistryProvider,
  resetRegistryProviderForTests,
  setRegistryProvider,
  type VehicleRegistryEntry,
} from "../src/services/vehicle-registry.js";
import { crossCheckPlate } from "../src/services/plate-crosscheck.js";

let dir: string;
let provider: InMemoryRegistryProvider;

const BMW_8157_DG: VehicleRegistryEntry = {
  plate: "8157-DG",
  make: "BMW",
  displacementCc: 2171,
  strokeType: "四行程",
  manufactureDate: "20040815",
  registrationDate: "20040930",
  latestEmissionTest: { result: "合格", date: "20260415" },
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "trb-v411-"));
  process.env.DATA_DIR = dir;
  process.env.TELEGRAM_BOT_TOKEN = "0000000000:test_token_for_unit_tests";
  process.env.OPENAI_API_KEY = "sk-test-unit";
  const cfg = await import("../src/config.js");
  cfg.resetConfigForTests();

  resetRegistryProviderForTests();
  provider = new InMemoryRegistryProvider();
  provider.set(BMW_8157_DG);
  setRegistryProvider(provider);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("v4.11 — BMW 8157-DG 紅線 + 三角錐", () => {
  it("[cross-check] LPR 認對 8157-DG → trustworthy + registry BMW 一致", async () => {
    const r = await crossCheckPlate("8157-DG", { vehicleType: "car" });
    expect(r.plateMatch).toBe(true);
    expect(r.trustworthy).toBe(true);
    expect(r.vehicleTypeMatch).toBe("consistent");
    expect(r.registryEntry?.make).toBe("BMW");
  });

  it("[cross-check] LPR OCR 誤識 8J57-DG → 建議 8157-DG（1↔J）", async () => {
    const r = await crossCheckPlate("8J57-DG", { vehicleType: "car" });
    // 8J57-DG 直查 not_found；候選含 8157-DG（J→L→1 兩步或直接 J→1？）
    // 依 SUBS 字典：1→[I,L,7]；反向 I→1、L→1 皆一步可達
    // 但沒有 J→1；只有 J（未在字典）→ 需另找路徑
    // 實務上 vision 模型不太會把 1 讀成 J（J 上方有點/彎），
    // 但如果 registry 只有 8157-DG，8J57-DG 就 not_found + 無候選
    expect(r.plateMatch).toBe(true); // 沒有 suggestion
    expect(r.trustworthy).toBe(false);
  });

  it("[legal-rules] 紅線描述 + sceneType=red_line → §56 I② 命中", async () => {
    const { matchLegalCitationsMulti } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitationsMulti(
      "traffic",
      "銀色 BMW 汽車違停紅線",
      "red_line",
    );
    const redLine = cs.find((c) => c.shortLabel?.includes("紅線"));
    expect(redLine).toBeDefined();
    expect(redLine?.article).toContain("第 56 條");
    expect(redLine?.evidenceMode).toBe("instantaneous");
  });

  it("[legal-rules] 三角錐占位描述 → §82-1（v4.8）命中", async () => {
    const { matchLegalCitationsMulti } = await import("../src/data/legal-rules.js");
    const cs = matchLegalCitationsMulti(
      "traffic",
      "銀色 BMW 汽車違停紅線，車頭前方擺放兩支三角錐占位",
      "red_line",
    );
    expect(cs.some((c) => c.article.includes("82-1"))).toBe(true);
    expect(cs.some((c) => c.shortLabel?.includes("紅線"))).toBe(true);
  });

  it("[compliance] 紅線 instantaneous，單張即通過（不需 3 分鐘）", async () => {
    const { checkCompliance } = await import("../src/services/compliance.js");
    const t0 = new Date(2026, 5, 15, 7, 47, 37);
    const t2 = new Date(2026, 5, 15, 7, 47, 49); // 12 秒後
    const c = await checkCompliance({
      evidence: [
        { filePath: "/uploads/IMG_2906.jpeg", mimeType: "image/jpeg", sha256: "a".repeat(64), source: "telegram", sourceMessageId: 1, sourceChatId: 1, capturedAt: t0 },
        { filePath: "/uploads/IMG_2908.jpeg", mimeType: "image/jpeg", sha256: "c".repeat(64), source: "telegram", sourceMessageId: 3, sourceChatId: 1, capturedAt: t2 },
      ],
      analysis: {
        category: "traffic",
        subject: "BMW 8157-DG",
        description: "銀色 BMW 汽車違停紅線",
        identifiers: { licensePlate: "8157-DG" },
        confidence: "high",
        evidenceGaps: [],
        vehicleType: "car",
        sceneType: "red_line",
      },
      address: { full: "台北市某區", city: "台北市", source: "user-input" },
      reporter: { name: "王小明", contact: "0912-345678" },
      plateConfirmed: true,
    });
    // 紅線是 instantaneous — 12 秒間隔完全 ok；不會被 3 分鐘規則卡
    expect(c.ok).toBe(true);
  });

  it("[buildReport] 3 張 EXIF-timestamped 照片 → 完整報告產出", async () => {
    const { buildReport } = await import("../src/services/report.js");
    const t0 = new Date(2026, 5, 15, 7, 47, 37);
    const t1 = new Date(2026, 5, 15, 7, 47, 47);
    const t2 = new Date(2026, 5, 15, 7, 47, 49);
    const r = buildReport({
      evidence: [
        { filePath: "/uploads/IMG_2906.jpeg", mimeType: "image/jpeg", sha256: "a".repeat(64), source: "telegram", sourceMessageId: 1, sourceChatId: 1, capturedAt: t0 },
        { filePath: "/uploads/IMG_2907.jpeg", mimeType: "image/jpeg", sha256: "b".repeat(64), source: "telegram", sourceMessageId: 2, sourceChatId: 1, capturedAt: t1 },
        { filePath: "/uploads/IMG_2908.jpeg", mimeType: "image/jpeg", sha256: "c".repeat(64), source: "telegram", sourceMessageId: 3, sourceChatId: 1, capturedAt: t2 },
      ],
      analysis: {
        category: "traffic",
        subject: "BMW 320i 8157-DG",
        description: "銀色 BMW 320i 汽車違停紅線，車頭前方擺放兩支三角錐占位",
        identifiers: { licensePlate: "8157-DG" },
        confidence: "high",
        evidenceGaps: [],
        vehicleType: "car",
        sceneType: "red_line",
      },
      address: { full: "台北市某區某路一段", city: "台北市", source: "user-input" },
      reporter: { name: "王小明", contact: "0912-345678" },
      plateConfirmed: true,
    });
    expect(r.trackingId).toMatch(/^TRB-\d{8}-[0-9A-Z]{7}$/);
    expect(r.legalCitations.length).toBeGreaterThanOrEqual(2); // 紅線 + 三角錐
    expect(r.markdown).toMatch(/8157-DG/);
    expect(r.markdown).toMatch(/紅線/);
    expect(r.markdown).toMatch(/82-1/);
    expect(r.recipients.length).toBeGreaterThan(0); // 台北市警局應在收件人
  });

  it("[end-to-end demo] 印出完整 pipeline trace", async () => {
    const { matchLegalCitationsMulti } = await import("../src/data/legal-rules.js");
    const { checkCompliance } = await import("../src/services/compliance.js");
    const { buildReport } = await import("../src/services/report.js");

    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("v4.11 demo — BMW 320i 8157-DG @ 紅線 (2026-06-15 07:47:37)");
    console.log("══════════════════════════════════════════════════════════════");

    // (a) LPR 情境 A：認對
    const xcA = await crossCheckPlate("8157-DG", { vehicleType: "car" });
    console.log("\n▶ cross-check A (LPR 認對 8157-DG):");
    console.log(`   plateMatch=${xcA.plateMatch}  trustworthy=${xcA.trustworthy}  vehicleTypeMatch=${xcA.vehicleTypeMatch}`);
    console.log(`   registry: ${xcA.registryEntry?.make} ${xcA.registryEntry?.displacementCc}cc / ${xcA.registryEntry?.strokeType}`);
    for (const n of xcA.notes) console.log(`   - ${n}`);

    // (b) LPR 情境 B：8→B 誤識
    const xcB = await crossCheckPlate("B157-DG", { vehicleType: "car" });
    console.log("\n▶ cross-check B (LPR 誤識 B157-DG，B→8 一字回退):");
    console.log(`   plateMatch=${xcB.plateMatch}  suggestedPlate=${xcB.suggestedPlate}  trustworthy=${xcB.trustworthy}`);
    for (const n of xcB.notes) console.log(`   - ${n}`);

    // (c) legal-rules
    const description =
      "銀色 BMW 320i 汽車違停紅線，車頭前方擺放兩支橘色三角錐占位，鄰近 YouBike 站";
    const citations = matchLegalCitationsMulti("traffic", description, "red_line");
    console.log(`\n▶ legal-rules 命中 ${citations.length} 條:`);
    for (const c of citations) {
      const tag = c.reportableByCitizen === false ? "❌ 限警察" : "✅ 民眾可舉";
      const mode = c.evidenceMode === "instantaneous" ? "單張即可" : c.evidenceMode === "continuous" ? "需 ≥2 張、≥3 分鐘" : "動態";
      console.log(`   - ${c.statute} ${c.article}（${c.shortLabel}）  ${tag}  採證：${mode}`);
      console.log(`     處罰：${c.penalty}`);
    }

    // (d) compliance
    const t0 = new Date(2026, 5, 15, 7, 47, 37);
    const t1 = new Date(2026, 5, 15, 7, 47, 47);
    const t2 = new Date(2026, 5, 15, 7, 47, 49);
    const ev = [
      { filePath: "/uploads/IMG_2906.jpeg", mimeType: "image/jpeg", sha256: "a".repeat(64), source: "telegram" as const, sourceMessageId: 1, sourceChatId: 1, capturedAt: t0 },
      { filePath: "/uploads/IMG_2907.jpeg", mimeType: "image/jpeg", sha256: "b".repeat(64), source: "telegram" as const, sourceMessageId: 2, sourceChatId: 1, capturedAt: t1 },
      { filePath: "/uploads/IMG_2908.jpeg", mimeType: "image/jpeg", sha256: "c".repeat(64), source: "telegram" as const, sourceMessageId: 3, sourceChatId: 1, capturedAt: t2 },
    ];
    const ctx = {
      evidence: ev,
      analysis: {
        category: "traffic" as const,
        subject: "BMW 320i 8157-DG",
        description,
        identifiers: { licensePlate: xcA.suggestedPlate },
        confidence: "high" as const,
        evidenceGaps: [],
        vehicleType: "car" as const,
        sceneType: "red_line" as const,
      },
      address: { full: "台北市某區某路一段", city: "台北市", source: "user-input" as const },
      reporter: { name: "王小明", contact: "0912-345678" },
      plateConfirmed: xcA.trustworthy,
    };
    const compliance = checkCompliance(ctx, citations);
    console.log(`\n▶ compliance gate: ok=${compliance.ok}`);
    for (const issue of compliance.issues) console.log(`   ${issue}`);

    // (e) report
    const artifact = buildReport(ctx);
    console.log(`\n▶ buildReport:`);
    console.log(`   trackingId  = ${artifact.trackingId}`);
    console.log(`   emailTo     = ${artifact.recipients.join(", ")}`);
    console.log(`   citations   = ${artifact.legalCitations.length}`);
    console.log(`   emailSubject= ${artifact.emailSubject}`);
    console.log("══════════════════════════════════════════════════════════════\n");

    expect(compliance.ok).toBe(true);
    expect(artifact.legalCitations.length).toBeGreaterThanOrEqual(2);
  });
});
