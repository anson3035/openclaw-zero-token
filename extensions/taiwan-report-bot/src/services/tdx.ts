/**
 * TDX (Transport Data eXchange, https://tdx.transportdata.tw) client.
 *
 * Taiwan does NOT have a public plate-to-owner API (個資法). What IS
 * open is transport infrastructure data — roads, bus stops, traffic
 * markings (in some cities). We use it to enhance the violation
 * evidence chain, not to query the vehicle.
 *
 * Without TDX_CLIENT_ID / TDX_CLIENT_SECRET, requests run in anonymous
 * mode and may be rate-limited. Get free credentials at:
 *   https://tdx.transportdata.tw/register
 */
import { loadConfig } from "../config.js";

const TDX_BASE = "https://tdx.transportdata.tw/api/basic";
const TDX_AUTH_URL =
  "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";

interface CachedToken {
  token: string;
  expiresAt: number;
}
let cachedToken: CachedToken | undefined;

async function getToken(): Promise<string | undefined> {
  const cfg = loadConfig();
  if (!cfg.TDX_CLIENT_ID || !cfg.TDX_CLIENT_SECRET) return undefined;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.TDX_CLIENT_ID,
    client_secret: cfg.TDX_CLIENT_SECRET,
  });
  const res = await fetch(TDX_AUTH_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) {
    console.error(`[tdx] auth failed ${res.status}`);
    return undefined;
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.token;
}

async function tdxFetch<T = unknown>(path: string): Promise<T> {
  const url = `${TDX_BASE}${path}`;
  const token = await getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`TDX ${res.status} ${res.statusText}: ${url}`);
  }
  return (await res.json()) as T;
}

const CITY_CODE: Record<string, string> = {
  台北市: "Taipei",
  新北市: "NewTaipei",
  桃園市: "Taoyuan",
  台中市: "Taichung",
  台南市: "Tainan",
  高雄市: "Kaohsiung",
  基隆市: "Keelung",
  新竹市: "HsinchuCity",
  新竹縣: "HsinchuCounty",
  苗栗縣: "MiaoliCounty",
  彰化縣: "ChanghuaCounty",
  南投縣: "NantouCounty",
  雲林縣: "YunlinCounty",
  嘉義市: "ChiayiCity",
  嘉義縣: "ChiayiCounty",
  屏東縣: "PingtungCounty",
  宜蘭縣: "YilanCounty",
  花蓮縣: "HualienCounty",
  台東縣: "TaitungCounty",
  澎湖縣: "PenghuCounty",
  金門縣: "KinmenCounty",
  連江縣: "LienchiangCounty",
};

export function tdxCityCode(zhName: string): string | undefined {
  return CITY_CODE[zhName] ?? CITY_CODE[zhName.replace(/臺/g, "台")];
}

export interface NearbyBusStop {
  uid: string;
  name: string;
  lat: number;
  lon: number;
  distanceMeters: number;
}

interface RawBusStop {
  StopUID?: string;
  StopID?: string;
  StopName?: { Zh_tw?: string; En?: string };
  StopPosition?: { PositionLat?: number; PositionLon?: number };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find bus stops within `radiusMeters` of a coordinate using TDX's
 * spatial filter. Used by the compliance pipeline: a parked vehicle
 * within 10 m of a bus stop triggers §56-1-4 (公車招呼站 10 m 內停車).
 *
 * Returns [] on TDX failure (graceful degradation).
 */
export async function findNearbyBusStops(
  zhCityOrCode: string,
  lat: number,
  lon: number,
  radiusMeters: number = 15,
): Promise<NearbyBusStop[]> {
  const city = CITY_CODE[zhCityOrCode] ?? zhCityOrCode;
  // TDX spatial filter: nearby(<lat>,<lon>,<meters>)
  const path = `/v2/Bus/Stop/City/${city}?$spatialFilter=nearby(${lat},${lon},${radiusMeters})&$format=JSON&$top=20`;
  try {
    const raw = await tdxFetch<RawBusStop[]>(path);
    if (!Array.isArray(raw)) return [];
    const out: NearbyBusStop[] = [];
    for (const r of raw) {
      const rLat = r.StopPosition?.PositionLat;
      const rLon = r.StopPosition?.PositionLon;
      if (typeof rLat !== "number" || typeof rLon !== "number") continue;
      out.push({
        uid: r.StopUID ?? r.StopID ?? "",
        name: r.StopName?.Zh_tw ?? r.StopName?.En ?? "(未命名)",
        lat: rLat,
        lon: rLon,
        distanceMeters: haversineMeters(lat, lon, rLat, rLon),
      });
    }
    out.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return out;
  } catch (err) {
    console.error("[tdx] findNearbyBusStops failed:", (err as Error).message);
    return [];
  }
}

/**
 * Check whether the bus-stop §56-1-4 condition is triggered.
 * Returns the nearest stop within 10 m, if any.
 */
export async function checkBusStop10mViolation(
  zhCity: string,
  lat: number,
  lon: number,
): Promise<NearbyBusStop | undefined> {
  const stops = await findNearbyBusStops(zhCity, lat, lon, 12);
  return stops.find((s) => s.distanceMeters <= 10);
}

export const _exposedForTests = { haversineMeters, CITY_CODE };
