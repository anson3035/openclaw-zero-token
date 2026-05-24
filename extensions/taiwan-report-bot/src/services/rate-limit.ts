interface Bucket {
  tokens: number;
  updatedAt: number;
}

const ANALYSIS_CAPACITY = 5;
const ANALYSIS_REFILL_PER_HOUR = 10;
const SEND_CAPACITY = 3;
const SEND_REFILL_PER_HOUR = 5;

const analysisBuckets = new Map<number, Bucket>();
const sendBuckets = new Map<number, Bucket>();

function take(
  map: Map<number, Bucket>,
  userId: number,
  capacity: number,
  refillPerHour: number,
): boolean {
  const now = Date.now();
  const existing = map.get(userId) ?? { tokens: capacity, updatedAt: now };
  const elapsedMs = now - existing.updatedAt;
  const refill = (elapsedMs / 3_600_000) * refillPerHour;
  const tokens = Math.min(capacity, existing.tokens + refill);
  if (tokens < 1) {
    map.set(userId, { tokens, updatedAt: now });
    return false;
  }
  map.set(userId, { tokens: tokens - 1, updatedAt: now });
  return true;
}

export function tryConsumeAnalysis(userId: number): boolean {
  return take(analysisBuckets, userId, ANALYSIS_CAPACITY, ANALYSIS_REFILL_PER_HOUR);
}

export function tryConsumeSend(userId: number): boolean {
  return take(sendBuckets, userId, SEND_CAPACITY, SEND_REFILL_PER_HOUR);
}

export function rateLimitMessage(action: "analysis" | "send"): string {
  if (action === "analysis") {
    return `⚠ 已達分析次數上限（${ANALYSIS_CAPACITY} 件 / 約 ${Math.round((3600 * ANALYSIS_CAPACITY) / ANALYSIS_REFILL_PER_HOUR / 60)} 分鐘恢復一件）。請稍後再試。`;
  }
  return `⚠ 已達寄送次數上限（${SEND_CAPACITY} 封 / 約 ${Math.round((3600 * SEND_CAPACITY) / SEND_REFILL_PER_HOUR / 60)} 分鐘恢復一封）。`;
}

export function resetForTests(): void {
  analysisBuckets.clear();
  sendBuckets.clear();
}
