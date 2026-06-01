/**
 * 隱私馬賽克處理 — 使用 sharp 對 vision 偵測到的隱私區域加密
 *
 * 為何重要：
 *   - 個資法 §5：個資蒐集不得逾越目的
 *   - 第三方車牌、人臉、住址門牌與本案違規無關
 *   - 機關收到清晰個資負有保密義務，但若使用者自己先處理可降低個資外洩風險
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import type { PrivacyRegion } from "../types.js";

/**
 * 對影像之多個區域加馬賽克（高斯模糊）。
 *
 * 演算法：
 *   1. 對每個 bbox 區域提取
 *   2. 強烈模糊（sigma=15）
 *   3. composite 回原圖
 *
 * 比起 pixelation，模糊更難復原，且視覺上仍能看出車輛/人物存在。
 */
export async function applyPrivacyMask(
  inputPath: string,
  regions: PrivacyRegion[],
  outputPath: string,
): Promise<string> {
  if (regions.length === 0) {
    // 無區域需處理，直接複製
    await mkdir(dirname(outputPath), { recursive: true });
    await sharp(inputPath).toFile(outputPath);
    return outputPath;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  const img = sharp(inputPath);
  const meta = await img.metadata();
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) throw new Error("無法讀取影像尺寸");

  // 為每個區域產生模糊後的 patch
  const composites = await Promise.all(
    regions.map(async (r) => {
      const left = Math.max(0, Math.round(r.bbox.x * W));
      const top = Math.max(0, Math.round(r.bbox.y * H));
      const width = Math.min(W - left, Math.round(r.bbox.w * W));
      const height = Math.min(H - top, Math.round(r.bbox.h * H));
      if (width <= 4 || height <= 4) return null;

      // 對該區域：提取 → 模糊 → 準備 composite
      const blurredBuf = await sharp(inputPath)
        .extract({ left, top, width, height })
        .blur(15)
        .toBuffer();

      return {
        input: blurredBuf,
        left,
        top,
      };
    }),
  );

  await img
    .composite(composites.filter((c): c is NonNullable<typeof c> => c !== null))
    .jpeg({ quality: 92 })
    .toFile(outputPath);

  return outputPath;
}

/**
 * 描述產生函式 — 給報告書用，列出已馬賽克之區域。
 */
export function describePrivacyMasks(regions: PrivacyRegion[]): string {
  if (regions.length === 0) return "無需馬賽克處理。";
  const counts: Record<string, number> = {};
  for (const r of regions) {
    counts[r.type] = (counts[r.type] ?? 0) + 1;
  }
  const labels: Record<string, string> = {
    face: "人臉",
    plate: "第三方車牌",
    address: "住址門牌",
    person: "第三人身形",
    other: "其他個資",
  };
  return Object.entries(counts)
    .map(([k, v]) => `${labels[k] ?? k} ×${v}`)
    .join("、");
}
