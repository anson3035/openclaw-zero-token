import exifr from "exifr";
import type { GeoPoint } from "../types.js";

interface ExifResult {
  capturedAt?: Date;
  gps?: GeoPoint;
}

export async function readExif(filePath: string): Promise<ExifResult> {
  try {
    const data = await exifr.parse(filePath, {
      gps: true,
      pick: ["DateTimeOriginal", "CreateDate", "ModifyDate", "latitude", "longitude"],
    });
    if (!data) return {};

    const result: ExifResult = {};
    const ts: unknown = data.DateTimeOriginal ?? data.CreateDate ?? data.ModifyDate;
    if (ts instanceof Date) result.capturedAt = ts;
    else if (typeof ts === "string") {
      const parsed = new Date(ts);
      if (!Number.isNaN(parsed.getTime())) result.capturedAt = parsed;
    }

    if (typeof data.latitude === "number" && typeof data.longitude === "number") {
      result.gps = { lat: data.latitude, lon: data.longitude };
    }
    return result;
  } catch {
    return {};
  }
}
