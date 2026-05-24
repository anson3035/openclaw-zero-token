import { loadConfig } from "../config.js";
import type { GeoPoint, ResolvedAddress } from "../types.js";

const TAIWAN_CITIES = [
  "台北市",
  "新北市",
  "桃園市",
  "台中市",
  "台南市",
  "高雄市",
  "基隆市",
  "新竹市",
  "新竹縣",
  "苗栗縣",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義市",
  "嘉義縣",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "台東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
];

const ZH_TW_MAP: Record<string, string> = {
  臺北市: "台北市",
  臺中市: "台中市",
  臺南市: "台南市",
  臺東縣: "台東縣",
};

function normalizeCity(name: string): string {
  return ZH_TW_MAP[name] ?? name;
}

export async function reverseGeocode(gps: GeoPoint): Promise<ResolvedAddress | undefined> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", gps.lat.toString());
  url.searchParams.set("lon", gps.lon.toString());
  url.searchParams.set("accept-language", "zh-TW");
  url.searchParams.set("zoom", "18");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": loadConfig().NOMINATIM_USER_AGENT },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      display_name?: string;
      address?: { city?: string; state?: string; county?: string; suburb?: string };
    };
    const addr = json.address ?? {};
    const rawCity = addr.city ?? addr.state ?? addr.county ?? "";
    const city = normalizeCity(rawCity);
    const district = addr.suburb;
    return {
      full: json.display_name ?? `${gps.lat}, ${gps.lon}`,
      city: TAIWAN_CITIES.includes(city) ? city : undefined,
      district,
      source: "exif-geocode",
    };
  } catch {
    return undefined;
  }
}

export function parseUserAddress(text: string): ResolvedAddress {
  const normalized = text.replace(/臺/g, "台");
  const cityMatch = TAIWAN_CITIES.find((c) => normalized.includes(c));
  return {
    full: text.trim(),
    city: cityMatch,
    source: "user-input",
  };
}
