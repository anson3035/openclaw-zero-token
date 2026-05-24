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

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, 64);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface RegisterInput {
  username: string;
  password: string;
  identity: ReporterIdentity;
}

export async function registerUser(input: RegisterInput): Promise<UserAccount> {
  if (input.password.length < 8) throw new Error("密碼至少 8 個字元");
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(input.username)) {
    throw new Error("帳號需為 3–32 字元，僅可含英數字、._-");
  }
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

export async function resolveToken(token: string): Promise<UserAccount | undefined> {
  const at = await getAuthToken(token);
  if (!at) return undefined;
  return getUserById(at.userId);
}

export async function revokeToken(token: string): Promise<void> {
  await deleteAuthToken(token);
}

export function sessionKeyForUser(userId: string): string {
  return `user:${userId}`;
}
