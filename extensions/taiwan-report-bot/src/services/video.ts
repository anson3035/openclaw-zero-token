import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Resolve ffmpeg binary path. Prefers ffmpeg-static when installed; otherwise
 * falls back to the system `ffmpeg` on PATH.
 */
let ffmpegBin: string | undefined;
async function resolveFfmpeg(): Promise<string> {
  if (ffmpegBin) return ffmpegBin;
  try {
    const mod = await import("ffmpeg-static");
    const p = (mod.default ?? mod) as unknown as string | null;
    if (p) {
      ffmpegBin = p;
      return p;
    }
  } catch {
    // ffmpeg-static not installed — try system ffmpeg
  }
  ffmpegBin = "ffmpeg";
  return ffmpegBin;
}

function runFfmpeg(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise(async (resolve, reject) => {
    const bin = await resolveFfmpeg();
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

export async function getVideoDuration(videoPath: string): Promise<number | undefined> {
  const { stderr } = await runFfmpeg(["-i", videoPath, "-f", "null", "-"]);
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Extract N evenly-spaced frames from a video to JPEG files.
 *
 * Returns the paths of extracted frames, in chronological order.
 * If duration cannot be determined, falls back to extracting at fixed
 * timestamps 0.5s, 1.5s, 2.5s, ...
 */
export async function extractFrames(
  videoPath: string,
  outDir: string,
  count: number = 6,
): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const duration = await getVideoDuration(videoPath);

  const timestamps: number[] = [];
  if (duration && duration > 0.5) {
    // skip the first/last 5% to avoid letterbox / transition noise
    const start = duration * 0.05;
    const end = duration * 0.95;
    const step = (end - start) / Math.max(1, count - 1);
    for (let i = 0; i < count; i++) {
      timestamps.push(start + step * i);
    }
  } else {
    // unknown duration — just sample every 1 second up to count
    for (let i = 0; i < count; i++) timestamps.push(0.5 + i);
  }

  const frames: string[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i]!;
    const outPath = join(outDir, `frame-${String(i + 1).padStart(3, "0")}.jpg`);
    await mkdir(dirname(outPath), { recursive: true });
    const { code, stderr } = await runFfmpeg([
      "-y",
      "-ss",
      t.toFixed(2),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outPath,
    ]);
    if (code !== 0) {
      throw new Error(`ffmpeg frame extraction failed at t=${t.toFixed(2)}s: ${stderr.slice(-200)}`);
    }
    frames.push(outPath);
  }
  return frames;
}

export function isVideoPath(filePathOrMime: string): boolean {
  const lower = filePathOrMime.toLowerCase();
  return (
    lower.startsWith("video/") ||
    lower.endsWith(".mp4") ||
    lower.endsWith(".mov") ||
    lower.endsWith(".webm") ||
    lower.endsWith(".mkv") ||
    lower.endsWith(".avi")
  );
}
