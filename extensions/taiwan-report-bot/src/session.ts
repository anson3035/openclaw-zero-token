import type { ReportArtifact, ReportContext } from "./types.js";

interface SessionEntry {
  ctx: ReportContext;
  artifact: ReportArtifact;
  attachmentPath: string;
  createdAt: number;
}

const TTL_MS = 30 * 60 * 1000;
const store = new Map<number, SessionEntry>();

export function saveSession(
  chatId: number,
  entry: Omit<SessionEntry, "createdAt">,
): void {
  store.set(chatId, { ...entry, createdAt: Date.now() });
  pruneExpired();
}

export function getSession(chatId: number): SessionEntry | undefined {
  const entry = store.get(chatId);
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt > TTL_MS) {
    store.delete(chatId);
    return undefined;
  }
  return entry;
}

export function clearSession(chatId: number): void {
  store.delete(chatId);
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [chatId, entry] of store.entries()) {
    if (now - entry.createdAt > TTL_MS) store.delete(chatId);
  }
}
