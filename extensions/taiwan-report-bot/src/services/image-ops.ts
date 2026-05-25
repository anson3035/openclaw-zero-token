import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";

export interface BBox {
  /** All values in 0..1 normalized image coordinates (top-left origin). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Crop the plate region and upscale for higher effective resolution.
 *
 * Why this boosts ANPR accuracy: GPT-4o tokenises the input image; sending
 * the WHOLE photo wastes most of the visual capacity on irrelevant sky /
 * road. Cropping to the plate region (with a generous margin) and then
 * upscaling makes the same plate occupy ~10× more of the model's vision
 * tokens, dramatically improving character-level legibility.
 */
export async function cropAndUpscale(
  inputPath: string,
  bbox: BBox,
  outputPath: string,
  options: {
    /** Additional padding around bbox as a fraction of bbox dims. */
    marginFrac?: number;
    /** Upscale factor applied to the crop. */
    upscale?: number;
  } = {},
): Promise<string> {
  const { marginFrac = 0.35, upscale = 4 } = options;

  await mkdir(dirname(outputPath), { recursive: true });
  const img = sharp(inputPath);
  const meta = await img.metadata();
  const W = meta.width;
  const H = meta.height;
  if (!W || !H) throw new Error("could not read image dimensions");

  const px = bbox.x * W;
  const py = bbox.y * H;
  const pw = bbox.w * W;
  const ph = bbox.h * H;

  const marginX = pw * marginFrac;
  const marginY = ph * marginFrac;

  const left = Math.max(0, Math.round(px - marginX));
  const top = Math.max(0, Math.round(py - marginY));
  const width = Math.min(W - left, Math.round(pw + marginX * 2));
  const height = Math.min(H - top, Math.round(ph + marginY * 2));
  if (width <= 4 || height <= 4) {
    throw new Error(`crop region too small: ${width}x${height}`);
  }

  await img
    .extract({ left, top, width, height })
    .resize(Math.round(width * upscale), Math.round(height * upscale), {
      kernel: sharp.kernel.lanczos3,
      fastShrinkOnLoad: false,
    })
    .sharpen({ sigma: 1.2 })
    .normalise()
    .jpeg({ quality: 92 })
    .toFile(outputPath);

  return outputPath;
}
