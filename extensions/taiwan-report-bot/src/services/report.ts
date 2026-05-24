import { lookupRecipients, normalizePhoneE164 } from "../data/authorities.js";
import { categoryLabel, matchLegalCitations } from "../data/legal-rules.js";
import type {
  MediaEvidence,
  ReportArtifact,
  ReportContext,
  SmsArtifact,
} from "../types.js";
import { checkCompliance } from "./compliance.js";

function primary(ctx: ReportContext): MediaEvidence {
  return ctx.evidence[0]!;
}

function formatTimestamp(date?: Date): string {
  if (!date) return "未知（EXIF 缺失，建議補上拍攝時間）";
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCoords(ctx: ReportContext): string {
  const gps = primary(ctx).gps;
  if (!gps) return "未取得（EXIF 無 GPS 資料）";
  return `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}`;
}

function evidenceAssessment(ctx: ReportContext): string {
  const gaps = ctx.analysis.evidenceGaps;
  if (gaps.length === 0) {
    return "證據力充足：影像清晰、客體可辨識、時間地點明確。";
  }
  return `證據力分析：${gaps.join("；")}。建議補強。`;
}

function privacyAdvice(ctx: ReportContext): string {
  const tips: string[] = [];
  if (ctx.analysis.category !== "traffic") {
    tips.push("如畫面含第三人車牌或臉部，建議馬賽克處理");
  } else {
    tips.push("僅保留違規車輛車牌清晰，其餘第三方車牌建議馬賽克");
  }
  tips.push("住址門牌若非違規本體，請遮蔽");
  return tips.join("；") + "。";
}

function urgencyNotice(ctx: ReportContext): string {
  if (ctx.analysis.category === "building" || ctx.analysis.category === "environment") {
    return "\n\n> ⚠ 緊急通報建議：若屬現行進行中之危害（如建物倒塌、有害物質傾倒、火災），請優先撥打 110 或 1999。";
  }
  return "";
}

function condominiumNotice(ctx: ReportContext): string {
  if (ctx.analysis.category === "condominium") {
    return "\n\n> 📋 公寓大廈案件建議：本檢舉應優先聯繫管委會處理，並取得區分所有權人會議記錄作為佐證，再送主管機關裁處。";
  }
  return "";
}

function evidenceListMarkdown(ctx: ReportContext): string {
  return ctx.evidence
    .map(
      (e, i) =>
        `  ${i + 1}. ${formatTimestamp(e.capturedAt)} — SHA256 \`${e.sha256.slice(0, 16)}…\``,
    )
    .join("\n");
}

function buildOnlineFormUrl(
  baseUrl: string | undefined,
  ctx: ReportContext,
): string | undefined {
  if (!baseUrl) return undefined;
  const params = new URLSearchParams();
  if (ctx.analysis.identifiers.licensePlate) {
    params.set("plate", ctx.analysis.identifiers.licensePlate);
  }
  params.set("address", ctx.address.full);
  const t = primary(ctx).capturedAt;
  if (t) params.set("time", t.toISOString());
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}${params.toString()}`;
}

function formatSmsTimestamp(date?: Date): string {
  if (!date) return "拍攝時間待補";
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Build a Big-5/UCS-2 friendly SMS body, ≤ ~140 chars when possible.
 * Chinese SMS segments at 70 chars; keep concise to fit in 1–2 segments.
 */
export function buildSmsBody(ctx: ReportContext): string {
  const plate = ctx.analysis.identifiers.licensePlate ?? "車牌不明";
  const time = formatSmsTimestamp(primary(ctx).capturedAt);
  const addr =
    ctx.address.full.length > 40 ? `${ctx.address.full.slice(0, 40)}…` : ctx.address.full;
  const act =
    ctx.analysis.description.length > 20
      ? `${ctx.analysis.description.slice(0, 20)}…`
      : ctx.analysis.description;
  return `檢舉違停 車牌${plate} 時間${time} 地點${addr} 違規${act}`;
}

function buildSmsDeepLink(number: string, body: string): string {
  return `sms:${normalizePhoneE164(number)}?body=${encodeURIComponent(body)}`;
}

function buildSmsArtifact(ctx: ReportContext): SmsArtifact | undefined {
  if (ctx.analysis.category !== "traffic") return undefined;
  const recipient = lookupRecipients(ctx.address.city, "traffic");
  if (!recipient.smsNumber) return undefined;
  const body = buildSmsBody(ctx);
  return {
    number: recipient.smsNumber,
    body,
    deepLink: buildSmsDeepLink(recipient.smsNumber, body),
    note: recipient.smsNote,
  };
}

function complianceSection(issues: string[]): string {
  if (issues.length === 0) return "✅ 已通過送件前合規檢查。";
  return ["⚠ **送件前需補強**：", ...issues.map((i) => `- ${i}`)].join("\n");
}

function reporterLine(ctx: ReportContext): string {
  if (!ctx.reporter) return "（未具名 — 請先 /identify 設定身分後再送件）";
  const id = ctx.reporter.nationalId ? `（身分證末四碼 ${ctx.reporter.nationalId.slice(-4)}）` : "";
  return `${ctx.reporter.name}${id}．聯絡：${ctx.reporter.contact}`;
}

export function buildReport(ctx: ReportContext): ReportArtifact {
  const label = categoryLabel(ctx.analysis.category);
  const citations = matchLegalCitations(ctx.analysis.category, ctx.analysis.description);
  const recipient = lookupRecipients(ctx.address.city, ctx.analysis.category);
  const sms = buildSmsArtifact(ctx);
  const compliance = checkCompliance(ctx);

  const citationLines = citations
    .map((c) => `- **${c.statute} ${c.article}**：${c.penalty}`)
    .join("\n");

  const markdown = `### 違規檢舉報告書

**1. 基本資訊**
- 違規類型：${label}
- 違規地點：${ctx.address.full}
- 座標位置：${formatCoords(ctx)}
- 拍攝時間：${formatTimestamp(primary(ctx).capturedAt)}
- 證據張數：${ctx.evidence.length}
${evidenceListMarkdown(ctx)}

**2. 違規事實描述**
- 違規客體：${ctx.analysis.subject}
- 違規事項：${ctx.analysis.description}
${ctx.analysis.identifiers.licensePlate ? `- 車牌號碼：\`${ctx.analysis.identifiers.licensePlate}\`` : ""}

**3. 法條引用**
${citationLines}

**4. 檢舉人**
- ${reporterLine(ctx)}

**5. 證據檢核**
- ${evidenceAssessment(ctx)}
- 隱私處理建議：${privacyAdvice(ctx)}

**6. 送件前合規檢查**
${complianceSection(compliance.issues)}

**7. 承辦單位**
- Email：${recipient.email}${recipient.onlineForm ? `\n- 線上檢舉：${recipient.onlineForm}` : ""}${
    sms
      ? `\n- 簡訊檢舉：\`${sms.number}\`${sms.note ? `（${sms.note}）` : ""}\n  📱 一鍵發送：${sms.deepLink}`
      : ""
  }
${condominiumNotice(ctx)}${urgencyNotice(ctx)}`;

  const emailSubject = `【民眾檢舉】${label} - ${ctx.address.full}${
    ctx.analysis.identifiers.licensePlate ? ` (車牌 ${ctx.analysis.identifiers.licensePlate})` : ""
  }`;

  const evidenceLines = ctx.evidence
    .map(
      (e, i) =>
        `  ${i + 1}. ${formatTimestamp(e.capturedAt)}  SHA256: ${e.sha256}`,
    )
    .join("\n");

  const reporterBlock = ctx.reporter
    ? `【檢舉人】
姓名：${ctx.reporter.name}
聯絡：${ctx.reporter.contact}${ctx.reporter.nationalId ? `\n身分證末四碼：${ctx.reporter.nationalId.slice(-4)}` : ""}

`
    : "";

  const emailBody = `承辦單位 鈞鑒：

茲依《${citations[0]?.statute ?? ""}》${citations[0]?.article ?? ""}之規定，檢舉以下違規事實，請依法查處。

${reporterBlock}【違規類型】${label}
【違規地點】${ctx.address.full}
【座標位置】${formatCoords(ctx)}
【拍攝時間】${formatTimestamp(primary(ctx).capturedAt)}
【證據張數】${ctx.evidence.length}
${evidenceLines}

【違規事實】
${ctx.analysis.description}

${ctx.analysis.identifiers.licensePlate ? `【車牌號碼】${ctx.analysis.identifiers.licensePlate}\n\n` : ""}【法條依據】
${citations.map((c) => `- ${c.statute} ${c.article}：${c.penalty}`).join("\n")}

${ctx.userNote ? `【檢舉人補充】\n${ctx.userNote}\n\n` : ""}相關影像證據（${ctx.evidence.length} 張，附 SHA256 雜湊以驗證未經竄改）隨信附上，敬請查收。如需補充說明，請逕予回覆。

此致
${recipient.email.split("@")[1] ?? "承辦單位"}

檢舉人 敬上
（檢舉時間：${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}）`;

  return {
    markdown,
    emailSubject,
    emailBody,
    recipients: [recipient.email],
    onlineFormUrl: buildOnlineFormUrl(recipient.onlineForm, ctx),
    sms,
    legalCitations: citations,
    compliance,
  };
}
