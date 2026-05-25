import { join } from "node:path";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { loadConfig, smtpConfigured, userAllowed } from "./config.js";
import { audit } from "./services/audit.js";
import { readExif } from "./services/exif.js";
import { reverseGeocode, parseUserAddress } from "./services/geocoding.js";
import { recognizePlate } from "./services/lpr.js";
import { runLprPipeline } from "./services/lpr-pipeline.js";
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
import { extractFrames, isVideoPath } from "./services/video.js";
import { analyzeMedia, enrichPlateWithLpr, overrideCategory } from "./services/vision.js";
import { clearSession, getSession, saveSession, tgSubject } from "./session.js";
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
        "/lpr — 商業級車牌辨識（ANPR，含 Top-3 候選與字元級分析）",
        "/plate <車牌> — 人工核可車牌（LPR 信心不足時必要）",
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
      "/identify  /whoami  /draft  /send  /confirm  /lpr  /plate <車牌>  /sms  /to <email>  /category <type>  /address <地址>  /cancel  /forgetme",
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
    await audit({ type: "identity_set", subject: tgSubject(ctx.chat.id), meta: { userId: ctx.from?.id } });
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
  bot.command("lpr", async (ctx) => {
    const session = await getSession(ctx.chat.id);
    if (!session) {
      await ctx.reply("尚無待處理檢舉。請先傳送照片或影片。");
      return;
    }
    const imagePaths = session.attachmentPaths.filter((p) => !isVideoPath(p));
    if (imagePaths.length === 0) {
      await ctx.reply("⚠ 本次案件無可分析之圖片（僅含影片時請先重新上傳，系統會自動抽幀）。");
      return;
    }
    await ctx.reply(`🔍 商業級車牌辨識中（${imagePaths.length} 張影像，2-pass + MOTC 驗證）…`);
    try {
      const pipe = await runLprPipeline(imagePaths, session.ctx.analysis.subject || "Unspecified");
      const lpr = pipe.lpr;
      const conf = lpr.resolved_plate.confidence_score;
      const cap = lpr.analysis.capture_quality;
      const candidates = lpr.candidates ?? [];
      const perChar = lpr.analysis.per_character ?? [];

      const lowCharLines = perChar
        .filter((c) => c.confidence < 0.85)
        .map(
          (c) =>
            `  位置 ${c.position}: \`${c.primary}\` (${(c.confidence * 100).toFixed(0)}%)  可能為: ${c.alternatives.join(", ") || "（無）"}`,
        );

      const candidateLines = candidates
        .slice(0, 3)
        .map(
          (c, i) =>
            `  ${i + 1}. \`${c.license_plate_number}\` — ${(c.joint_confidence * 100).toFixed(0)}%  · ${c.reasoning}`,
        );

      const reply = [
        "📋 *車牌辨識結果（ANPR v3 — 兩階段精讀）*",
        "",
        `*首選車牌*：\`${lpr.resolved_plate.license_plate_number}\``,
        `*最終信心*：${(conf * 100).toFixed(0)}%${cap !== undefined ? `  (capture quality: ${(cap * 100).toFixed(0)}%)` : ""}`,
        `*Pipeline*：${pipe.passes} pass${pipe.passes > 1 ? "es" : ""} · agreement=${pipe.agreement ? "✅" : "❌"} · MOTC=${pipe.motcValid ? "✅ valid" : "❌ INVALID"}`,
        `*車牌類型*：${lpr.analysis.plate_type}`,
        `*影像瑕疵*：${lpr.analysis.detected_artifacts.join("、") || "none"}`,
        `*原始 OCR*：\`${lpr.analysis.raw_visual_text}\``,
        "",
        candidateLines.length > 0 ? "*Top 候選清單*：" : "",
        ...candidateLines,
        "",
        lowCharLines.length > 0 ? "*字元級不確定性*：" : "",
        ...lowCharLines,
        "",
        "*Pipeline 提升軌跡*：",
        ...pipe.notes.map((n) => `  • ${n}`),
        "",
        lpr.resolved_plate.requires_human_verification
          ? "❗ *仍需您人工核可* — 請用 `/plate <車牌>` 確認或修正後再 /send"
          : "✅ 信心充足，可直接送件",
      ]
        .filter((s) => s !== "")
        .join("\n");
      await ctx.reply(reply, { parse_mode: "Markdown" });
    } catch (err) {
      await ctx.reply(`❌ LPR 失敗：${(err as Error).message}`);
    }
  });

  bot.command("plate", async (ctx) => {
    const session = await getSession(ctx.chat.id);
    if (!session) {
      await ctx.reply("尚無待處理檢舉。請先傳送照片或影片。");
      return;
    }
    const raw = ctx.message.text.slice("/plate".length).trim().toUpperCase();
    if (!raw) {
      await ctx.reply(
        [
          "用法：`/plate <車牌>`",
          "範例：`/plate BGM-9090`",
          "",
          "此指令會：",
          "1. 覆寫車牌號碼",
          "2. 標記為「已人工核可」（解除 compliance gate）",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
      return;
    }
    // Light validation: 3 letters + 4 digits OR 2 letters + 4 digits etc.
    const normalized = raw.replace(/\s+/g, "");
    if (!/^[A-Z0-9]{1,4}[- ]?[A-Z0-9]{1,4}$/.test(normalized)) {
      await ctx.reply("❌ 車牌格式不符。請使用如 `BGM-9090` 或 `AB-1234` 的格式。");
      return;
    }
    const withDash = normalized.includes("-") ? normalized : normalized.replace(/^([A-Z0-9]+)([0-9]{3,4})$/, "$1-$2");

    const newCtx: ReportContext = {
      ...session.ctx,
      analysis: {
        ...session.ctx.analysis,
        identifiers: { ...session.ctx.analysis.identifiers, licensePlate: withDash },
      },
      plateConfirmed: true,
      plateRequiresVerification: false,
    };
    const newArtifact = buildReport(newCtx);
    await saveSession(ctx.chat.id, {
      ctx: newCtx,
      artifact: newArtifact,
      attachmentPaths: session.attachmentPaths,
      createdAt: session.createdAt,
    });
    await ctx.reply(`✅ 車牌已確認為 \`${withDash}\`，並標記為人工核可。輸入 /draft 查看更新後報告。`, {
      parse_mode: "Markdown",
    });
  });

  bot.command("draft", async (ctx) => {
    const session = await getSession(ctx.chat.id);
    if (!session) {
      await ctx.reply("尚無待處理檢舉。請先傳送照片或影片。");
      return;
    }
    await audit({ type: "draft_viewed", subject: tgSubject(ctx.chat.id), meta: { userId: ctx.from?.id } });
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
      subject: tgSubject(ctx.chat.id),
      meta: { userId: ctx.from?.id, to: target },
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
      await audit({ type: "rate_limited", subject: tgSubject(ctx.chat.id), meta: { userId: ctx.from?.id, action: "send" } });
      await ctx.reply(rateLimitMessage("send"));
      return;
    }
    await audit({ type: "send_confirmed", subject: tgSubject(ctx.chat.id), meta: { userId: ctx.from?.id } });
    try {
      const result = await sendReport(
        session.artifact,
        session.attachmentPaths,
        session.pendingSend.to,
      );
      await audit({
        type: "sent",
        subject: tgSubject(ctx.chat.id),
        meta: { userId: ctx.from?.id, messageId: result.messageId, accepted: result.accepted },
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
        subject: tgSubject(ctx.chat.id),
        meta: { userId: ctx.from?.id, error: (err as Error).message },
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
    await audit({ type: "cancelled", subject: tgSubject(ctx.chat.id), meta: { userId: ctx.from?.id } });
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
      subject: tgSubject(first.chat.id),
      meta: { userId: first.from?.id, action: "analysis" },
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
      subject: tgSubject(first.chat.id),
      meta: { userId: first.from.id, count: evidences.length, sha256: evidences.map((e) => e.sha256) },
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

    // For analysis we need image bytes. If the primary evidence is a video,
    // extract a middle frame and use that for the violation classifier.
    let primaryForAnalysis = evidences[0]!.filePath;
    const lprPool: string[] = [];
    for (const e of evidences) {
      if (e.mimeType.startsWith("video/")) {
        try {
          const frames = await extractFrames(e.filePath, `${e.filePath}.frames`, 5);
          if (frames.length > 0) {
            if (e === evidences[0]) primaryForAnalysis = frames[Math.floor(frames.length / 2)]!;
            lprPool.push(...frames);
          }
        } catch (err) {
          console.error("[video] frame extraction failed:", (err as Error).message);
        }
      } else {
        lprPool.push(e.filePath);
      }
    }

    // analyze using the primary frame
    let analysis = await analyzeMedia(primaryForAnalysis, caption);
    await audit({
      type: "analyzed",
      subject: tgSubject(first.chat.id),
      meta: { userId: first.from.id, category: analysis.category, confidence: analysis.confidence },
    });

    // for traffic cases, run commercial-grade ANPR over all available frames.
    // Note: LLM vision is unreliable on small/oblique plates, so we treat the
    // LPR output as a suggestion and require user confirmation when it's not
    // high-confidence (compliance gate enforces this before /send).
    let plateRequiresVerification = false;
    let lprBestGuess: string | undefined;
    if (analysis.category === "traffic" && lprPool.length > 0) {
      const enriched = await enrichPlateWithLpr(analysis, lprPool);
      analysis = enriched.analysis;
      if (!enriched.trustworthy) {
        plateRequiresVerification = true;
        lprBestGuess = enriched.lpr?.resolved_plate.license_plate_number;
      }
    }

    const identity = await getIdentity(first.chat.id);
    const reportCtx: ReportContext = {
      evidence: evidences,
      analysis,
      address,
      ...(caption ? { userNote: caption } : {}),
      ...(identity ? { reporter: identity } : {}),
      plateConfirmed: false,
      plateRequiresVerification,
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
      subject: tgSubject(first.chat.id),
      meta: { userId: first.from.id, ok: artifact.compliance.ok, issues: artifact.compliance.issues.length },
    });

    await first.reply(artifact.markdown, { parse_mode: "Markdown" });

    if (plateRequiresVerification) {
      await first.reply(
        [
          "🔍 *車牌人工核可流程*",
          "",
          `LPR 引擎的最佳猜測：\`${lprBestGuess ?? "（無）"}\``,
          "但因影像距離 / 角度 / 解析度限制，**信心不足以自動採用**。",
          "",
          "請您**親自查看上傳的照片**，確認車牌後輸入：",
          "  `/plate BGM-9090`  （以實際讀到的字元為準）",
          "",
          "或使用 /lpr 查看 Top 候選清單與字元級分析。",
          "未經 /plate 核可前，/send 將被擋下。",
        ].join("\n"),
        { parse_mode: "Markdown" },
      );
    }

    await first.reply(
      [
        "下一步：",
        artifact.compliance.ok
          ? "• ✅ 已通過合規檢查"
          : "• ⚠ 尚未通過合規檢查，請依上方提示補強",
        plateRequiresVerification ? "• /plate <車牌> — 人工核可車牌（必要）" : undefined,
        "• /lpr — 查看 ANPR 候選清單與字元級分析",
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
