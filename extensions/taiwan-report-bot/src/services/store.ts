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

export interface UserAccount {
  id: string;
  username: string;
  passwordHash: string;
  identity: ReporterIdentity;
  createdAt: number;
}

export interface AuthToken {
  token: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
}

interface StoreSchema {
  sessions: Record<string, PersistedSession>;
  identities: Record<string, ReporterIdentity>;
  users: Record<string, UserAccount>;
  usersByName: Record<string, string>; // username → userId
  authTokens: Record<string, AuthToken>;
}

const SESSION_TTL_MS = 30 * 60 * 1000;

function storePath(): string {
  return join(loadConfig().DATA_DIR, "store.json");
}

async function readStore(): Promise<StoreSchema> {
  const p = storePath();
  try {
    const raw = await readFile(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoreSchema>;
    return {
      sessions: parsed.sessions ?? {},
      identities: parsed.identities ?? {},
      users: parsed.users ?? {},
      usersByName: parsed.usersByName ?? {},
      authTokens: parsed.authTokens ?? {},
    };
  } catch {
    return { sessions: {}, identities: {}, users: {}, usersByName: {}, authTokens: {} };
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
  for (const [token, t] of Object.entries(data.authTokens)) {
    if (t.expiresAt < now) delete data.authTokens[token];
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

// ---------- generic key-based ----------
export async function saveSessionByKey(key: string, session: PersistedSession): Promise<void> {
  const data = pruneExpired(await readStore());
  data.sessions[key] = session;
  await writeStore(data);
}

export async function getSessionByKey(key: string): Promise<PersistedSession | undefined> {
  const data = pruneExpired(await readStore());
  const s = data.sessions[key];
  if (!s) return undefined;
  return reviveDates(s);
}

export async function clearSessionByKey(key: string): Promise<void> {
  const data = await readStore();
  delete data.sessions[key];
  await writeStore(data);
}

export async function saveIdentityByKey(key: string, identity: ReporterIdentity): Promise<void> {
  const data = await readStore();
  data.identities[key] = identity;
  await writeStore(data);
}

export async function getIdentityByKey(key: string): Promise<ReporterIdentity | undefined> {
  const data = await readStore();
  return data.identities[key];
}

export async function clearIdentityByKey(key: string): Promise<void> {
  const data = await readStore();
  delete data.identities[key];
  await writeStore(data);
}

// ---------- Telegram chatId convenience wrappers ----------
const tg = (chatId: number) => `tg:${chatId}`;

export const saveSession = (chatId: number, s: PersistedSession) => saveSessionByKey(tg(chatId), s);
export const getSession = (chatId: number) => getSessionByKey(tg(chatId));
export const clearSession = (chatId: number) => clearSessionByKey(tg(chatId));
export const saveIdentity = (chatId: number, id: ReporterIdentity) => saveIdentityByKey(tg(chatId), id);
export const getIdentity = (chatId: number) => getIdentityByKey(tg(chatId));
export const clearIdentity = (chatId: number) => clearIdentityByKey(tg(chatId));

// ---------- Users + Auth ----------
export async function createUser(user: UserAccount): Promise<void> {
  const data = await readStore();
  if (data.usersByName[user.username]) {
    throw new Error("username already taken");
  }
  data.users[user.id] = user;
  data.usersByName[user.username] = user.id;
  await writeStore(data);
}

export async function getUserById(id: string): Promise<UserAccount | undefined> {
  const data = await readStore();
  return data.users[id];
}

export async function getUserByName(username: string): Promise<UserAccount | undefined> {
  const data = await readStore();
  const id = data.usersByName[username];
  if (!id) return undefined;
  return data.users[id];
}

export async function saveAuthToken(token: AuthToken): Promise<void> {
  const data = pruneExpired(await readStore());
  data.authTokens[token.token] = token;
  await writeStore(data);
}

export async function getAuthToken(token: string): Promise<AuthToken | undefined> {
  const data = pruneExpired(await readStore());
  const t = data.authTokens[token];
  if (!t || t.expiresAt < Date.now()) return undefined;
  return t;
}

export async function deleteAuthToken(token: string): Promise<void> {
  const data = await readStore();
  delete data.authTokens[token];
  await writeStore(data);
}
