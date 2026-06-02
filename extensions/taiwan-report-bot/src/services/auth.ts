import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { ReporterIdentity } from "../types.js";
import {
  createUser,
  deleteAuthToken,
  getAuthToken,
  getUserById,
  getUserByName,
  saveAuthToken,
  type UserAccount,
} from "./store.js";

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days

/**
 * scrypt 參數 — N 從預設 16384（16MB）提升到 65536（64MB）以對抗
 * GPU/ASIC 暴力破解。RFC 7914 建議 N≥2^17 但需平衡 server CPU 預算。
 * maxmem 需 ≥ 128 × N × r 才不會 throw（預設僅 32MB，會被 65536 超出）。
 *
 * 為避免「升參數即作廢所有舊密碼」，verifyPassword 同時支援：
 *   - 舊格式：`saltHex:hashHex`（預設 N=16384）
 *   - 新格式：`scrypt$N$r$p$saltHex$hashHex`
 * 使用者下次登入時可由上層觸發 rehash。
 */
const SCRYPT_N = 1 << 16; // 65536
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 128 * 1024 * 1024; // 128MB

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  // 新格式：scrypt$N$r$p$saltHex$hashHex
  if (stored.startsWith("scrypt$")) {
    const parts = stored.split("$");
    if (parts.length !== 6) return false;
    const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
    const N = Number.parseInt(nStr ?? "", 10);
    const r = Number.parseInt(rStr ?? "", 10);
    const p = Number.parseInt(pStr ?? "", 10);
    if (
      !Number.isFinite(N) ||
      !Number.isFinite(r) ||
      !Number.isFinite(p) ||
      N <= 0 ||
      r <= 0 ||
      p <= 0
    ) {
      return false;
    }
    // 防呆：避免攻擊者餵 N=2^30 拖死 CPU
    if (N > 1 << 18 || r > 16 || p > 4) return false;
    const salt = Buffer.from(saltHex ?? "", "hex");
    const expected = Buffer.from(hashHex ?? "", "hex");
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = scryptSync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  // legacy 格式：saltHex:hashHex（Node 預設 N=16384）
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * 驗證使用者輸入之身分資料不含換行 / 控制字元，避免於審計日誌（JSONL）
 * 注入偽造事件行，或於 PDF / Markdown 產出中跳脫文本框。
 */
function validateIdentity(identity: ReporterIdentity): void {
  const fields: Array<[string, string | undefined]> = [
    ["name", identity.name],
    ["contact", identity.contact],
    ["nationalId", identity.nationalId],
  ];
  for (const [k, v] of fields) {
    if (v === undefined) continue;
    if (typeof v !== "string") throw new Error(`身分欄位 ${k} 必須為字串`);
    if (v.length === 0) throw new Error(`身分欄位 ${k} 不可為空`);
    if (v.length > 200) throw new Error(`身分欄位 ${k} 超過 200 字元`);
    // 換行 / tab / NUL / 其他控制字元
    if (/[\r\n\t\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(v)) {
      throw new Error(`身分欄位 ${k} 含非法控制字元`);
    }
  }
}

export interface RegisterInput {
  username: string;
  password: string;
  identity: ReporterIdentity;
}

export async function registerUser(input: RegisterInput): Promise<UserAccount> {
  if (input.password.length < 8) throw new Error("密碼至少 8 個字元");
  if (input.password.length > 256) throw new Error("密碼過長");
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(input.username)) {
    throw new Error("帳號需為 3–32 字元，僅可含英數字、._-");
  }
  validateIdentity(input.identity);
  const existing = await getUserByName(input.username);
  if (existing) throw new Error("帳號已存在");

  const account: UserAccount = {
    id: randomBytes(8).toString("hex"),
    username: input.username,
    passwordHash: hashPassword(input.password),
    identity: input.identity,
    createdAt: Date.now(),
  };
  await createUser(account);
  return account;
}

export async function authenticate(
  username: string,
  password: string,
): Promise<UserAccount | undefined> {
  const user = await getUserByName(username);
  if (!user) return undefined;
  if (!verifyPassword(password, user.passwordHash)) return undefined;
  return user;
}

export async function issueToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await saveAuthToken({
    token,
    userId,
    issuedAt: Date.now(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return token;
}

/**
 * In-memory revoked token blacklist — closes the race window between
 * revokeToken() and the file-backed store being read by another request.
 * 即使 store 寫入有 ms-level 排隊，process 內 revoke 立即生效。
 * 重啟後仍依賴 store（已 delete），故 TTL 與 token 一致即可。
 */
const revokedTokens = new Set<string>();

export async function resolveToken(token: string): Promise<UserAccount | undefined> {
  if (revokedTokens.has(token)) return undefined;
  const at = await getAuthToken(token);
  if (!at) return undefined;
  return getUserById(at.userId);
}

export async function revokeToken(token: string): Promise<void> {
  revokedTokens.add(token);
  await deleteAuthToken(token);
}

export function sessionKeyForUser(userId: string): string {
  return `user:${userId}`;
}

// Test-only export — clears in-memory revocation blacklist.
export function _resetAuthInMemoryForTests(): void {
  revokedTokens.clear();
}
