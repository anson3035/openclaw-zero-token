import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadConfig } from "../config.js";

export type AuditEventType =
  | "media_received"
  | "analyzed"
  | "report_built"
  | "draft_viewed"
  | "send_requested"
  | "send_confirmed"
  | "sent"
  | "send_failed"
  | "cancelled"
  | "identity_set"
  | "rate_limited"
  | "auth_login"
  | "auth_register"
  | "auth_logout";

export interface AuditEvent {
  ts: string; // ISO
  type: AuditEventType;
  /** Generic subject key: `tg:<chatId>` for Telegram, `user:<userId>` for web/desktop. */
  subject: string;
  meta?: Record<string, unknown>;
}

function logPath(): string {
  return join(loadConfig().DATA_DIR, "audit.log.jsonl");
}

export async function audit(event: Omit<AuditEvent, "ts">): Promise<void> {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  const p = logPath();
  await mkdir(dirname(p), { recursive: true });
  await appendFile(p, line, "utf8");
}
