import { join } from "node:path";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { loadConfig, smtpConfigured, userAllowed } from "./config.js";
import { audit } from "./services/audit.js";
import { readExif } from "./services/exif.js";
import { reverseGeocode, parseUserAddress } from "./services/geocoding.js";
import { MailerNotConfiguredError, sendReport } from "./services/mailer.js";
import {
  rateLimitMessage,
  tryConsumeAnalysis,
  tryConsumeSend,
} from "./services/rate-limit.js";
import { buildReport } from "./services/report.js";
import {
  clearIdentity,
  getIdentity,
  saveIdentity,
} from "./services/store.js";
import { analyzeMedia, overrideCategory } from "./services/vision.js";
import { clearSession, getSession, saveSession } from "./session.js";
import type {
  MediaEvidence,
  ReporterIdentity,
  ReportContext,
  ResolvedAddress,
  ViolationCategory,
} from "./types.js";
import { downloadToFile } from "./utils/download.js";
import { sha256 } from "./utils/hash.js";

const ALBUM_BUFFER_MS = 1500;
const albumBuffers = new Map<string, { messages: import("telegraf").Context[]; timer: NodeJS.Timeout }>();

export function createBot(): Telegraf {
  const bot = new Telegraf(loadConfig().TELEGRAM_BOT_TOKEN);

  bot.use(async (ctx, next) => {
    const uid = ctx.from?.id;
    if (uid && !userAllowed(uid)) {
      await ctx.reply("您尚未獲授權使用本檢舉 Bot。請聯絡管理員加入白名單。");
      return;
    }
    return next();
  });

  bot.start((ctx) =>
    ctx.reply(
      [
        "📸 *台灣違規檢舉 Bot*",
        "",
        "*第一次使用：請先 `/identify` 設定具名身分*",
        "依道交條例 §7-1，民眾檢舉須具名，匿名報案不受理。",
        "",
        "傳送照片或影片給我，我會：",
        "1. 自動辨識違規類型（交通／環保／建築／公寓大廈）",
        "2. 對應法條與承辦單位",
        "3. 進行送件前合規檢查（具名／多張持續證據／車牌可辨識／地址完整）",
        "4. 產出檢舉報告書 + email + SMS deep link + 線上表單預填連結",
        "",
        "💡 *持續性違規（如違停）請傳送相簿*（≥2 張、間隔 ≥3 分鐘），合於法定舉證要件。",
        "",
        "*指令清單*：",
        "/identify <姓名>|<聯絡方式>[|<身分證末四碼>] — 設定/更新檢舉人身分",
        "/whoami — 顯示目前身分",
        "/forgetme — 移除身分資料",
        "/draft — 取得 email 草稿（手動寄出，較合規）",
        "/send — 進入寄送流程（會先要求 confirm）",
        "/confirm — 確認寄出（在 /send 之後）",
        "/sms — 取得簡訊舉發內容與一鍵發送連結（限交通違停）",
        "/to <email> — 覆寫收件單位",
        "/category <traffic|environment|building|condominium> — 強制指定違規類型",
        "/address <地址> — 手動補上地址（EXIF 無 GPS 時）",
        "/cancel — 取消本次檢舉",
        "/help — 顯示此說明",
      ].join("\n"),
      { parse_mode: "Markdown" },
    ),
  );

  bot.help((ctx) =>
    ctx.reply(
      "/identify  /whoami  /draft  /send  /confirm  /sms  /to <email>  /category <type>  /address <地址>  /cancel  /forgetme",
    ),
  );

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------
  bot.command("identify", async (ctx) => {
    const raw = ctx.message.text.slice("/identify".length).trim();
    const parts = raw.split("|").map((s) => s.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      await ctx.reply(
        "用法：/identify 王小明|0912-345678|1234\n第三段（身分證末四碼）可省略；用於正式公文舉證。",
      );
      return;
    }
    const identity: ReporterIdentity = {
      name: parts[0],
      contact: parts[1],
      ...(parts[2] ? { nationalId: parts[2] } : {}),
    };
    await saveIdentity(ctx.chat.id, identity);
    await audit({ type: "identity_set", chatId: ctx.chat.id, userId: ctx.from?.id });
    await ctx.reply(
      `✅ 已記錄身分：${identity.name}（${identity.contact}${identity.nationalId ? `；末四碼 ${identity.nationalId.slice(-4)}` : ""}）。\n稍後送件時將自動帶入報告。`,
    );
  });

  bot.command("whoami", async (ctx) => {
    const id = await getIdentity(ctx.chat.id);
    if (!id) {
      await ctx.reply("尚未設定身分。請使用：/identify 王小明|0912-345678");
      return;
    }
    await ctx.reply(
      `姓名：${id.name}\n聯絡：${id.contact}${id.nationalId ? `\n身分證末四碼：${id.nationalId.slice(-4)}` : ""}`,
    );
  });

  bot.command("forgetme", async (ctx) => {
    await clearIdentity(ctx.chat.id);
    await ctx.reply("✅ 已刪除您於本 Bot 上儲存的身分資料。");
  });

  // -------------------------------------------------------------------------
  // Media intake — handles both single messages and Telegram media groups (albums)
  // -------------------------------------------------------------------------
  bot.on(message("photo"), async (ctx) => {
    await ingest(ctx);
  });

  bot.on(message("video"), async (ctx) => {
    await ingest(ctx);
  });

  bot.on(message("document"), async (ctx) => {
    const mime = ctx.message.document.mime_type ?? "";
    if (mime.startsWith("image/") || mime.startsWith("video/")) {
      await ingest(ctx);
    }
  });

  // -------------------------------------------------------------------------
  // Workflow commands
  // -------------------------------------------------------------------------
  bot.command("draft", async (ctx) => {
    const session = await getSession(ctx.chat.id);
    if (!session) {
      await ctx.reply("尚無待處理檢舉。請先傳送照片或影片。");
      return;
    }
    await audit({ type: "draft_viewed", chatId: ctx.chat.id, userId: ctx.from?.id });
    const { artifact } = session;
    await ctx.reply(
      [
        "📧 *檢舉信草稿（請手動寄出）*",
        "",
        `*收件者*：${artifact.recipients.join(", ")}`,
        `*主旨*：${artifact.emailSubject}`,
        "",
        "```",
        artifact.emailBody,
        "```",
        artifact.onlineFormUrl ? `\n🔗 線上檢舉表單（預填）：${artifact.onlineFormUrl}` : "",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  });

  bot.command("send", async (ctx) => {
    const session = await getSession(ctx.chat.id);
    if (!session) {
      await ctx.reply("尚無待處理檢舉。請先傳送照片或影片。");
      return;
    }
    if (!smtpConfigured()) {
      await ctx.reply("⚠ SMTP 尚未設定，無法代寄。請使用 /draft 取得草稿後手動寄出。");
      return;
    }
    if (!session.artifact.compliance.ok) {
      await ctx.reply(
        ["❌ *尚未通過合規檢查，無法送件*：", "", ...session.artifact.compliance.issues].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }
    const parts = ctx.message.text.split(/\s+/);
    const override = parts[1];
    const target = override ?? session.artifact.recipients[0]!;

    session.pendingSend = { to: target };
    await saveSession(ctx.chat.id, session);
    await audit({
      type: "send_requested",
      chatId: ctx.chat.id,
      userId: ctx.from?.id,
      meta: { to: target },
    });

    await ctx.reply(
      [
        "⚠ *請確認以下送件資訊*：",
        "",
        `*收件者*：${target}`,
        `*主旨*：${session.artifact.emailSubject}`,
        `*附件數*：${session.attachmentPaths.length}`,
        `*檢舉人*：${session.ctx.reporter?.name ?? "（未設定）"}`,
        "",
        "確認無誤請輸入 `/confirm` 寄出，或 `/cancel` 取消。",
      ].join("\n"),
      { parse_mode: "Markdown" },
    );
  });

  bot.command("confirm", async (ctx) => {
    const session = await getSession(ctx.chat.id);
    if (!session?.pendingSend) {
      await ctx.reply("尚無待確認之送件。請先 /send。");
      return;
    }
    if (!ctx.from || !tryConsumeSend(ctx.from.id)) {
      await audit({ type: "rate_limited", chatId: ctx.chat.id, userId: ctx.from?.id, meta: { action: "send" } });
      await ctx.reply(rateLimitMessage("send"));
      return;
    }
    await audit({ type: "send_confirmed", chatId: ctx.chat.id, userId: ctx.from?.id });
    try {
      const result = await sendReport(
        session.artifact,
        session.attachmentPaths,
        session.pendingSend.to,
      );
      await audit({
        type: "sent",
        chatId: ctx.chat.id,
        userId: ctx.from?.id,
        meta: { messageId: result.messageId, accepted: result.accepted },
      });
      await ctx.reply(
        `✅ 已寄出檢舉信\n收件：${result.accepted.join(", ")}\nMessage-ID：${result.messageId}`,
      );
      await clearSession(ctx.chat.id);
    } catch (err) {
      const msg = err instanceof MailerNotConfiguredError
        ? "⚠ SMTP 尚未設定。請使用 /draft。"
        : `❌ 寄送失敗：${(err as Error).message}`;
      await audit({
        type: "send_failed",
        chatId: ctx.chat.id,
        userId: ctx.from?.id,
        meta: { error: (err as Error).message },
      });
      await ctx.reply(msg);
    }
  });

  bot.command("sms", async (ctx) => {
    const session = await getSession(ctx.chat.id);
    if (!session) {
      await ctx.reply("尚無待處理檢舉。請先傳送照片或影片。");
      return;
    }
    const sms = session.artifact.sms;
    if (!sms) {
      await ctx.reply(
        "📵 此案件不適用簡訊檢舉。\n簡訊檢舉目前僅支援交通違規（違停），且需可辨識車牌與所在縣市。",
      );
      return;
    }
    await ctx.reply(
      [
        "📱 *簡訊檢舉*",
        "",
        `*發送至*：\`${sms.number}\``,
        sms.note ? `*說明*：${sms.note}` : "",
        "",
        "*簡訊內容*：",
        "```",
        sms.body,
        "```",
        "",
        `👉 一鍵發送（手機開啟）：${sms.deepLink}`,
        "",
        "⚠ 請於發送後保留簡訊發送記錄與原始照片，便於後續舉證。",
      ]
        .filter(Boolean)
        .join("\n"),
      { parse_mode: "Markdown" },
    );
  });

  bot.command("to", async (ctx) => {
    const session = await getSession(ctx.chat.id);
    if (!session) {
      await ctx.reply("尚無待處理檢舉。請先傳送照片或影片。");
      return;
    }
    const email = ctx.message.text.split(/\s+/)[1];
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await ctx.reply("用法：/to your@example.com");
      return;
    }
    session.artifact.recipients = [email];
    await saveSession(ctx.chat.id, session);
    await ctx.reply(`✅ 已將收件單位改為 ${email}`);
  });

  bot.command("category", async (ctx) => {
    const session = await getSession(ctx.chat.id);
    if (!session) {
      await ctx.reply("尚無待處理檢舉。請先傳送照片或影片。");
      return;
    }
    const cat = ctx.message.text.split(/\s+/)[1] as ViolationCategory | undefined;
    if (!cat || !["traffic", "environment", "building", "condominium"].includes(cat)) {
      await ctx.reply("用法：/category traffic|environment|building|condominium");
      return;
    }
    const newAnalysis = overrideCategory(session.ctx.analysis, cat);
    const newCtx: ReportContext = { ...session.ctx, analysis: newAnalysis };
    const newArtifact = buildReport(newCtx);
    await saveSession(ctx.chat.id, {
      ctx: newCtx,
      artifact: newArtifact,
      attachmentPaths: session.attachmentPaths,
      createdAt: session.createdAt,
    });
    await ctx.reply(`✅ 已重新分類為 ${cat}，報告已重新產出。輸入 /draft 查看。`);
  });

  bot.command("address", async (ctx) => {
    const session = await getSession(ctx.chat.id);
    if (!session) {
      await ctx.reply("尚無待處理檢舉。請先傳送照片或影片。");
      return;
    }
    const addressText = ctx.message.text.slice(8).trim();
    if (!addressText) {
      await ctx.reply("用法：/address 台北市中正區忠孝東路一段1號");
      return;
    }
    const address = parseUserAddress(addressText);
    const newCtx: ReportContext = { ...session.ctx, address };
    const newArtifact = buildReport(newCtx);
    await saveSession(ctx.chat.id, {
      ctx: newCtx,
      artifact: newArtifact,
      attachmentPaths: session.attachmentPaths,
      createdAt: session.createdAt,
    });
    await ctx.reply(`✅ 地址已更新為「${addressText}」。輸入 /draft 查看更新後的報告。`);
  });

  bot.command("cancel", async (ctx) => {
    await clearSession(ctx.chat.id);
    await audit({ type: "cancelled", chatId: ctx.chat.id, userId: ctx.from?.id });
    await ctx.reply("已取消本次檢舉。");
  });

  bot.catch((err, ctx) => {
    console.error("[telegraf]", err);
    ctx.reply("⚠ 內部錯誤，請稍後再試。").catch(() => {});
  });

  return bot;
}

// ----------------------------------------------------------------------------
// Ingestion: dispatches to album buffer or single-message path.
// ----------------------------------------------------------------------------
async function ingest(ctx: import("telegraf").Context): Promise<void> {
  if (!ctx.chat || !ctx.message) return;
  const msg = ctx.message;
  const groupId =
    "media_group_id" in msg && msg.media_group_id
      ? `${ctx.chat.id}:${msg.media_group_id}`
      : undefined;

  if (groupId) {
    const buf = albumBuffers.get(groupId) ?? { messages: [], timer: setTimeout(() => {}, 0) };
    clearTimeout(buf.timer);
    buf.messages.push(ctx);
    buf.timer = setTimeout(() => {
      albumBuffers.delete(groupId);
      void handleAlbum(buf.messages).catch((err) => {
        console.error("[album]", err);
      });
    }, ALBUM_BUFFER_MS);
    albumBuffers.set(groupId, buf);
    return;
  }

  await handleAlbum([ctx]);
}

async function handleAlbum(ctxs: import("telegraf").Context[]): Promise<void> {
  const first = ctxs[0]!;
  if (!first.chat || !first.message) return;

  if (!first.from || !tryConsumeAnalysis(first.from.id)) {
    await audit({
      type: "rate_limited",
      chatId: first.chat.id,
      userId: first.from?.id,
      meta: { action: "analysis" },
    });
    await first.reply(rateLimitMessage("analysis"));
    return;
  }

  const count = ctxs.length;
  await first.reply(`📥 收到 ${count} ${count > 1 ? "張證據" : "張證據"}，正在分析中…（約 10–20 秒）`);

  try {
    const evidences: MediaEvidence[] = [];
    let caption: string | undefined;
    for (const c of ctxs) {
      const meta = extractFileMeta(c);
      if (!meta.fileId) continue;
      if (meta.caption && !caption) caption = meta.caption;
      const fileLink = await c.telegram.getFileLink(meta.fileId);
      const destPath = join(
        loadConfig().EVIDENCE_DIR,
        `${first.chat!.id}-${Date.now()}-${evidences.length}.${meta.suffix}`,
      );
      await downloadToFile(fileLink.toString(), destPath);
      const exif = await readExif(destPath);
      const hash = await sha256(destPath);
      evidences.push({
        filePath: destPath,
        mimeType: meta.suffix === "mp4" ? "video/mp4" : "image/jpeg",
        capturedAt: exif.capturedAt,
        gps: exif.gps,
        sha256: hash,
        source: "telegram",
        sourceMessageId: c.message!.message_id,
        sourceChatId: first.chat!.id,
      });
    }

    if (evidences.length === 0) {
      await first.reply("⚠ 無法識別此媒體類型。");
      return;
    }

    await audit({
      type: "media_received",
      chatId: first.chat.id,
      userId: first.from.id,
      meta: { count: evidences.length, sha256: evidences.map((e) => e.sha256) },
    });

    // resolve address from first evidence with GPS
    const withGps = evidences.find((e) => e.gps);
    let address: ResolvedAddress | undefined;
    if (withGps?.gps) address = await reverseGeocode(withGps.gps);
    if (!address) {
      address = {
        full: "（未取得地址，請使用 /address 補上）",
        source: "user-input",
      };
    }

    // analyze using the primary (first) image
    const analysis = await analyzeMedia(evidences[0]!.filePath, caption);
    await audit({
      type: "analyzed",
      chatId: first.chat.id,
      userId: first.from.id,
      meta: { category: analysis.category, confidence: analysis.confidence },
    });

    const identity = await getIdentity(first.chat.id);
    const reportCtx: ReportContext = {
      evidence: evidences,
      analysis,
      address,
      ...(caption ? { userNote: caption } : {}),
      ...(identity ? { reporter: identity } : {}),
    };
    const artifact = buildReport(reportCtx);

    await saveSession(first.chat.id, {
      ctx: reportCtx,
      artifact,
      attachmentPaths: evidences.map((e) => e.filePath),
      createdAt: Date.now(),
    });
    await audit({
      type: "report_built",
      chatId: first.chat.id,
      userId: first.from.id,
      meta: { ok: artifact.compliance.ok, issues: artifact.compliance.issues.length },
    });

    await first.reply(artifact.markdown, { parse_mode: "Markdown" });
    await first.reply(
      [
        "下一步：",
        artifact.compliance.ok
          ? "• ✅ 已通過合規檢查"
          : "• ⚠ 尚未通過合規檢查，請依上方提示補強",
        "• /draft — 取得 email 草稿",
        smtpConfigured() ? "• /send — 進入寄送流程（需 /confirm）" : "• (代寄未啟用：SMTP 未設定)",
        artifact.sms ? "• /sms — 取得簡訊檢舉內容與一鍵發送連結" : undefined,
        "• /category <type> — 修正違規類型",
        "• /address <地址> — 補上 / 修正地址",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (err) {
    console.error(err);
    await first.reply(`❌ 分析失敗：${(err as Error).message}`);
  }
}

function extractFileMeta(ctx: import("telegraf").Context): {
  fileId?: string;
  suffix: string;
  caption?: string;
} {
  const msg = ctx.message;
  if (!msg) return { suffix: "bin" };
  if ("photo" in msg && msg.photo) {
    const largest = msg.photo[msg.photo.length - 1];
    return { fileId: largest?.file_id, suffix: "jpg", caption: msg.caption };
  }
  if ("video" in msg && msg.video) {
    return { fileId: msg.video.file_id, suffix: "mp4", caption: msg.caption };
  }
  if ("document" in msg && msg.document) {
    const mime = msg.document.mime_type ?? "";
    const suffix = mime.startsWith("video/") ? "mp4" : "jpg";
    return { fileId: msg.document.file_id, suffix, caption: msg.caption };
  }
  return { suffix: "bin" };
}
