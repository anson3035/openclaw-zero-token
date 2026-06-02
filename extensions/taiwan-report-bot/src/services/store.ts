import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
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

/**
 * 序列化所有寫入避免 race condition（concurrent saveSession 等會覆寫彼此）。
 * 同時用「寫到 temp file 再 rename」確保中斷時不會留下半寫的 store.json。
 */
let writeQueue: Promise<void> = Promise.resolve();

async function writeStore(data: StoreSchema): Promise<void> {
  // 串接到 queue 尾巴，確保上一個寫完才開始
  const work = writeQueue.then(async () => {
    const p = storePath();
    await mkdir(dirname(p), { recursive: true });
    // atomic write: 先寫 temp 再 rename（POSIX rename 是原子的）
    const tmp = `${p}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await rename(tmp, p);
  });
  // 推進 queue（即使本次失敗，下次仍可繼續）
  writeQueue = work.catch(() => {});
  return work;
}

/**
 * Read-modify-write 序列化 helper：把整段 read → modify → write 作為單一
 * critical section，避免兩個 caller 各自讀後互相覆寫對方的修改。
 *
 * 用法：await mutateStore(data => { data.sessions[k] = ...; });
 */
async function mutateStore(
  mutator: (data: StoreSchema) => StoreSchema | void,
): Promise<void> {
  const work = writeQueue.then(async () => {
    const p = storePath();
    let data: StoreSchema;
    try {
      const raw = await readFile(p, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoreSchema>;
      data = {
        sessions: parsed.sessions ?? {},
        identities: parsed.identities ?? {},
        users: parsed.users ?? {},
        usersByName: parsed.usersByName ?? {},
        authTokens: parsed.authTokens ?? {},
      };
    } catch {
      data = { sessions: {}, identities: {}, users: {}, usersByName: {}, authTokens: {} };
    }
    const result = mutator(data) ?? data;
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(result, null, 2), "utf8");
    await rename(tmp, p);
  });
  writeQueue = work.catch(() => {});
  return work;
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
  await mutateStore((data) => {
    pruneExpired(data);
    data.sessions[key] = session;
  });
}

export async function getSessionByKey(key: string): Promise<PersistedSession | undefined> {
  const data = pruneExpired(await readStore());
  const s = data.sessions[key];
  if (!s) return undefined;
  return reviveDates(s);
}

export async function clearSessionByKey(key: string): Promise<void> {
  await mutateStore((data) => {
    delete data.sessions[key];
  });
}

export async function saveIdentityByKey(key: string, identity: ReporterIdentity): Promise<void> {
  await mutateStore((data) => {
    data.identities[key] = identity;
  });
}

export async function getIdentityByKey(key: string): Promise<ReporterIdentity | undefined> {
  const data = await readStore();
  return data.identities[key];
}

export async function clearIdentityByKey(key: string): Promise<void> {
  await mutateStore((data) => {
    delete data.identities[key];
  });
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
  await mutateStore((data) => {
    if (data.usersByName[user.username]) {
      throw new Error("username already taken");
    }
    data.users[user.id] = user;
    data.usersByName[user.username] = user.id;
  });
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
  await mutateStore((data) => {
    pruneExpired(data);
    data.authTokens[token.token] = token;
  });
}

export async function getAuthToken(token: string): Promise<AuthToken | undefined> {
  const data = pruneExpired(await readStore());
  const t = data.authTokens[token];
  if (!t || t.expiresAt < Date.now()) return undefined;
  return t;
}

export async function deleteAuthToken(token: string): Promise<void> {
  await mutateStore((data) => {
    delete data.authTokens[token];
  });
}
