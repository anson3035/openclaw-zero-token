import { lookupRecipients } from "../data/authorities.js";
import { categoryLabel, matchLegalCitations } from "../data/legal-rules.js";
import type { ReportArtifact, ReportContext } from "../types.js";

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
  const gps = ctx.evidence.gps;
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
  if (ctx.evidence.capturedAt) {
    params.set("time", ctx.evidence.capturedAt.toISOString());
  }
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}${params.toString()}`;
}

export function buildReport(ctx: ReportContext): ReportArtifact {
  const label = categoryLabel(ctx.analysis.category);
  const citations = matchLegalCitations(ctx.analysis.category, ctx.analysis.description);
  const recipient = lookupRecipients(ctx.address.city, ctx.analysis.category);

  const citationLines = citations
    .map((c) => `- **${c.statute} ${c.article}**：${c.penalty}`)
    .join("\n");

  const markdown = `### 違規檢舉報告書

**1. 基本資訊**
- 違規類型：${label}
- 違規地點：${ctx.address.full}
- 座標位置：${formatCoords(ctx)}
- 拍攝時間：${formatTimestamp(ctx.evidence.capturedAt)}

**2. 違規事實描述**
- 違規客體：${ctx.analysis.subject}
- 違規事項：${ctx.analysis.description}
${ctx.analysis.identifiers.licensePlate ? `- 車牌號碼：\`${ctx.analysis.identifiers.licensePlate}\`` : ""}

**3. 法條引用**
${citationLines}

**4. 證據檢核**
- ${evidenceAssessment(ctx)}
- 隱私處理建議：${privacyAdvice(ctx)}

**5. 承辦單位**
- Email：${recipient.email}${recipient.onlineForm ? `\n- 線上檢舉：${recipient.onlineForm}` : ""}
${condominiumNotice(ctx)}${urgencyNotice(ctx)}`;

  const emailSubject = `【民眾檢舉】${label} - ${ctx.address.full}${
    ctx.analysis.identifiers.licensePlate ? ` (車牌 ${ctx.analysis.identifiers.licensePlate})` : ""
  }`;

  const emailBody = `承辦單位 鈞鑒：

茲依《${citations[0]?.statute ?? ""}》${citations[0]?.article ?? ""}之規定，檢舉以下違規事實，請依法查處。

【違規類型】${label}
【違規地點】${ctx.address.full}
【座標位置】${formatCoords(ctx)}
【拍攝時間】${formatTimestamp(ctx.evidence.capturedAt)}

【違規事實】
${ctx.analysis.description}

${ctx.analysis.identifiers.licensePlate ? `【車牌號碼】${ctx.analysis.identifiers.licensePlate}\n\n` : ""}【法條依據】
${citations.map((c) => `- ${c.statute} ${c.article}：${c.penalty}`).join("\n")}

${ctx.userNote ? `【檢舉人補充】\n${ctx.userNote}\n\n` : ""}相關影像證據隨信附上，敬請查收。如需補充說明，請逕予回覆。

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
    legalCitations: citations,
  };
}
