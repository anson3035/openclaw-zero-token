import { join } from "node:path";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { loadConfig, smtpConfigured, userAllowed } from "./config.js";
import { reverseGeocode, parseUserAddress } from "./services/geocoding.js";
import { readExif } from "./services/exif.js";
import { MailerNotConfiguredError, sendReport } from "./services/mailer.js";
import { buildReport } from "./services/report.js";
import { analyzeMedia, overrideCategory } from "./services/vision.js";
import { clearSession, getSession, saveSession } from "./session.js";
import type { MediaEvidence, ReportContext, ResolvedAddress, ViolationCategory } from "./types.js";
import { downloadToFile } from "./utils/download.js";

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
        "直接傳送照片或影片給我，我會：",
        "1. 自動辨識違規類型（交通／環保／建築／公寓大廈）",
        "2. 對應法條與承辦單位",
        "3. 產出檢舉報告書",
        "",
        "可用指令：",
        "/draft — 取得本次檢舉信草稿（讓您手動寄出，較合規）",
        "/send — 由 Bot 代寄至承辦單位（需 SMTP 設定）",
        "/sms — 取得各縣市簡訊舉發內容與一鍵發送連結（限交通違停）",
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
    ctx.reply("/draft  /send  /sms  /to <email>  /category <type>  /address <地址>  /cancel"),
  );

  bot.on(message("photo"), async (ctx) => {
    await handleIncomingMedia(ctx);
  });

  bot.on(message("video"), async (ctx) => {
    await handleIncomingMedia(ctx);
  });

  bot.on(message("document"), async (ctx) => {
    const mime = ctx.message.document.mime_type ?? "";
    if (mime.startsWith("image/") || mime.startsWith("video/")) {
      await handleIncomingMedia(ctx);
    }
  });

  bot.command("sms", async (ctx) => {
    const session = getSession(ctx.chat.id);
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

  bot.command("draft", async (ctx) => {
    const session = getSession(ctx.chat.id);
    if (!session) {
      await ctx.reply("尚無待處理檢舉。請先傳送照片或影片。");
      return;
    }
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
    const session = getSession(ctx.chat.id);
    if (!session) {
      await ctx.reply("尚無待處理檢舉。請先傳送照片或影片。");
      return;
    }
    if (!smtpConfigured()) {
      await ctx.reply("⚠ SMTP 尚未設定，無法代寄。請使用 /draft 取得草稿後手動寄出。");
      return;
    }
    const parts = ctx.message.text.split(/\s+/);
    const override = parts[1];
    try {
      const result = await sendReport(session.artifact, session.attachmentPath, override);
      await ctx.reply(
        `✅ 已寄出檢舉信\n收件：${result.accepted.join(", ")}\nMessage-ID：${result.messageId}`,
      );
      clearSession(ctx.chat.id);
    } catch (err) {
      if (err instanceof MailerNotConfiguredError) {
        await ctx.reply("⚠ SMTP 尚未設定。請使用 /draft。");
      } else {
        await ctx.reply(`❌ 寄送失敗：${(err as Error).message}`);
      }
    }
  });

  bot.command("to", async (ctx) => {
    const session = getSession(ctx.chat.id);
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
    saveSession(ctx.chat.id, session);
    await ctx.reply(`✅ 已將收件單位改為 ${email}`);
  });

  bot.command("category", async (ctx) => {
    const session = getSession(ctx.chat.id);
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
    saveSession(ctx.chat.id, {
      ctx: newCtx,
      artifact: newArtifact,
      attachmentPath: session.attachmentPath,
    });
    await ctx.reply(`✅ 已重新分類為 ${cat}，報告已重新產出。輸入 /draft 查看。`);
  });

  bot.command("address", async (ctx) => {
    const session = getSession(ctx.chat.id);
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
    saveSession(ctx.chat.id, {
      ctx: newCtx,
      artifact: newArtifact,
      attachmentPath: session.attachmentPath,
    });
    await ctx.reply(`✅ 地址已更新為「${addressText}」。輸入 /draft 查看更新後的報告。`);
  });

  bot.command("cancel", async (ctx) => {
    clearSession(ctx.chat.id);
    await ctx.reply("已取消本次檢舉。");
  });

  bot.catch((err, ctx) => {
    console.error("[telegraf]", err);
    ctx.reply("⚠ 內部錯誤，請稍後再試。").catch(() => {});
  });

  return bot;
}

async function handleIncomingMedia(ctx: import("telegraf").Context): Promise<void> {
  if (!ctx.chat || !ctx.message) return;

  const { fileId, suffix, caption } = extractFileMeta(ctx);
  if (!fileId) {
    await ctx.reply("⚠ 無法識別此媒體類型。");
    return;
  }

  await ctx.reply("📥 收到證據，正在分析中…（約 10–20 秒）");

  try {
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const destPath = join(
      loadConfig().EVIDENCE_DIR,
      `${ctx.chat.id}-${Date.now()}.${suffix}`,
    );
    await downloadToFile(fileLink.toString(), destPath);

    const exif = await readExif(destPath);
    let address: ResolvedAddress | undefined;
    if (exif.gps) address = await reverseGeocode(exif.gps);
    if (!address) {
      address = {
        full: "（未取得地址，請使用 /address 補上）",
        source: "user-input",
      };
    }

    const analysis = await analyzeMedia(destPath, caption);

    const evidence: MediaEvidence = {
      filePath: destPath,
      mimeType: suffix === "mp4" ? "video/mp4" : "image/jpeg",
      capturedAt: exif.capturedAt,
      gps: exif.gps,
      source: "telegram",
      sourceMessageId: ctx.message.message_id,
      sourceChatId: ctx.chat.id,
    };

    const reportCtx: ReportContext = {
      evidence,
      analysis,
      address,
      userNote: caption,
    };
    const artifact = buildReport(reportCtx);

    saveSession(ctx.chat.id, { ctx: reportCtx, artifact, attachmentPath: destPath });

    await ctx.reply(artifact.markdown, { parse_mode: "Markdown" });
    await ctx.reply(
      [
        "下一步：",
        "• /draft — 取得 email 草稿",
        smtpConfigured() ? "• /send — Bot 代寄至承辦單位" : "• (代寄未啟用：SMTP 未設定)",
        artifact.sms ? "• /sms — 取得簡訊檢舉內容與一鍵發送連結" : undefined,
        "• /category <type> — 修正違規類型",
        "• /address <地址> — 補上 / 修正地址",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (err) {
    console.error(err);
    await ctx.reply(`❌ 分析失敗：${(err as Error).message}`);
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
