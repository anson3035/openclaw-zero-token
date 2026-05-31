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

/**
 * 查詢指定 subject 在 N 天內的「sent」事件次數。
 * 用於 compliance gate 偵測「職業檢舉達人」並提示，依 2022 道交 §7-1
 * 改革精神，避免被視為惡意大量舉發。
 *
 * 失敗時回傳 0（不阻斷主流程）。
 */
export async function countRecentSentReports(
  subject: string,
  windowDays: number = 30,
): Promise<number> {
  try {
    const { readFile } = await import("node:fs/promises");
    const p = logPath();
    const raw = await readFile(p, "utf8").catch(() => "");
    if (!raw) return 0;
    const cutoff = Date.now() - windowDays * 24 * 3600 * 1000;
    let count = 0;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as AuditEvent;
        if (ev.type !== "sent") continue;
        if (ev.subject !== subject) continue;
        if (new Date(ev.ts).getTime() < cutoff) continue;
        count++;
      } catch {
        /* skip malformed line */
      }
    }
    return count;
  } catch {
    return 0;
  }
}
