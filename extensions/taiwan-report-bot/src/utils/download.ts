import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function downloadToFile(url: string, destPath: string): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
}
