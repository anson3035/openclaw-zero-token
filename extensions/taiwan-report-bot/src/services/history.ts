/**
 * 歷史案件查詢 — 從 audit log 重建使用者送件紀錄
 *
 * 為何不用獨立資料表：
 *   - audit log 已是 single source of truth
 *   - JSONL append-only，不會與其他寫入競爭
 *   - 同一份資料同時供合規稽核與案件查詢
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import type { AuditEvent } from "./audit.js";

export interface CaseSummary {
  /** 內部追蹤號 */
  trackingId: string;
  /** 送出時間（ISO） */
  sentAt: string;
  /** 收件單位 email */
  recipient: string;
  /** SMTP message-id（機關回查用） */
  messageId?: string;
  /** 違規類型 */
  category?: string;
  /** 車牌（若有） */
  plate?: string;
  /** 違規地點 */
  address?: string;
  /** 命中之法條 short labels */
  legalCitations?: string[];
}

interface AuditEventWithMeta extends AuditEvent {
  meta?: {
    trackingId?: string;
    messageId?: string;
    accepted?: string[];
    category?: string;
    plate?: string;
    address?: string;
    citations?: string[];
    [k: string]: unknown;
  };
}

function logPath(): string {
  return join(loadConfig().DATA_DIR, "audit.log.jsonl");
}

async function readAuditEvents(subject: string): Promise<AuditEventWithMeta[]> {
  try {
    const raw = await readFile(logPath(), "utf8");
    const events: AuditEventWithMeta[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as AuditEventWithMeta;
        if (ev.subject === subject) events.push(ev);
      } catch {
        /* skip malformed */
      }
    }
    return events;
  } catch {
    return [];
  }
}

/**
 * 列出指定 subject 之歷史案件（按時間倒序）。
 *
 * 邏輯：找出所有 'sent' 事件 → 透過 trackingId 關聯到對應的 'report_built'
 * 事件取得更多 metadata（plate / address / citations）。
 */
export async function listUserCases(subject: string, limit = 50): Promise<CaseSummary[]> {
  const events = await readAuditEvents(subject);
  const builts = new Map<string, AuditEventWithMeta>();
  const sents: AuditEventWithMeta[] = [];

  for (const ev of events) {
    if (ev.type === "report_built" && ev.meta?.trackingId) {
      builts.set(ev.meta.trackingId, ev);
    } else if (ev.type === "sent") {
      sents.push(ev);
    }
  }

  const cases: CaseSummary[] = sents.map((sent) => {
    const tid = (sent.meta?.trackingId as string) ?? "(unknown)";
    const built = builts.get(tid);
    const summary: CaseSummary = {
      trackingId: tid,
      sentAt: sent.ts,
      recipient: (sent.meta?.accepted as string[] | undefined)?.[0] ?? "(unknown)",
    };
    if (sent.meta?.messageId) summary.messageId = sent.meta.messageId as string;
    if (built?.meta?.category) summary.category = built.meta.category as string;
    if (built?.meta?.plate) summary.plate = built.meta.plate as string;
    if (built?.meta?.address) summary.address = built.meta.address as string;
    if (built?.meta?.citations) summary.legalCitations = built.meta.citations as string[];
    return summary;
  });

  cases.sort((a, b) => (a.sentAt > b.sentAt ? -1 : 1));
  return cases.slice(0, limit);
}

export async function getUserCase(
  subject: string,
  trackingId: string,
): Promise<CaseSummary | undefined> {
  const cases = await listUserCases(subject, 1000);
  return cases.find((c) => c.trackingId === trackingId);
}
