import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadConfig } from "../config.js";
import type { ReporterIdentity, ReportArtifact, ReportContext } from "../types.js";

export interface PersistedSession {
  ctx: ReportContext;
  artifact: ReportArtifact;
  attachmentPaths: string[];
  createdAt: number;
  pendingSend?: { to?: string };
}

interface StoreSchema {
  sessions: Record<string, PersistedSession>; // key = chatId
  identities: Record<string, ReporterIdentity>; // key = chatId
}

const SESSION_TTL_MS = 30 * 60 * 1000;

function storePath(): string {
  return join(loadConfig().DATA_DIR, "store.json");
}

async function readStore(): Promise<StoreSchema> {
  const p = storePath();
  try {
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as StoreSchema;
  } catch {
    return { sessions: {}, identities: {} };
  }
}

async function writeStore(data: StoreSchema): Promise<void> {
  const p = storePath();
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2), "utf8");
}

function pruneExpired(data: StoreSchema): StoreSchema {
  const now = Date.now();
  for (const [k, v] of Object.entries(data.sessions)) {
    if (now - v.createdAt > SESSION_TTL_MS) delete data.sessions[k];
  }
  return data;
}

function reviveDates<T extends PersistedSession>(s: T): T {
  for (const e of s.ctx.evidence) {
    if (e.capturedAt && typeof e.capturedAt === "string") {
      e.capturedAt = new Date(e.capturedAt as unknown as string);
    }
  }
  return s;
}

export async function saveSession(chatId: number, session: PersistedSession): Promise<void> {
  const data = pruneExpired(await readStore());
  data.sessions[String(chatId)] = session;
  await writeStore(data);
}

export async function getSession(chatId: number): Promise<PersistedSession | undefined> {
  const data = pruneExpired(await readStore());
  const s = data.sessions[String(chatId)];
  if (!s) return undefined;
  return reviveDates(s);
}

export async function clearSession(chatId: number): Promise<void> {
  const data = await readStore();
  delete data.sessions[String(chatId)];
  await writeStore(data);
}

export async function saveIdentity(chatId: number, identity: ReporterIdentity): Promise<void> {
  const data = await readStore();
  data.identities[String(chatId)] = identity;
  await writeStore(data);
}

export async function getIdentity(chatId: number): Promise<ReporterIdentity | undefined> {
  const data = await readStore();
  return data.identities[String(chatId)];
}

export async function clearIdentity(chatId: number): Promise<void> {
  const data = await readStore();
  delete data.identities[String(chatId)];
  await writeStore(data);
}
