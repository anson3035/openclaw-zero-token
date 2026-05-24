import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadConfig, smtpConfigured } from "../config.js";
import { audit } from "../services/audit.js";
import {
  authenticate,
  issueToken,
  registerUser,
  resolveToken,
  revokeToken,
  sessionKeyForUser,
} from "../services/auth.js";
import { reverseGeocode, parseUserAddress } from "../services/geocoding.js";
import { readExif } from "../services/exif.js";
import { recognizePlate } from "../services/lpr.js";
import { MailerNotConfiguredError, sendReport } from "../services/mailer.js";
import {
  rateLimitMessage,
  tryConsumeAnalysis,
  tryConsumeSend,
} from "../services/rate-limit.js";
import { buildReport } from "../services/report.js";
import {
  clearSessionByKey,
  getSessionByKey,
  saveSessionByKey,
  type UserAccount,
} from "../services/store.js";
import { analyzeMedia, overrideCategory } from "../services/vision.js";
import type {
  MediaEvidence,
  ReporterIdentity,
  ReportContext,
  ResolvedAddress,
  ViolationCategory,
} from "../types.js";
import { sha256 } from "../utils/hash.js";

type AppEnv = { Variables: { user: UserAccount } };

const FRONTEND_DIR = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../web",
);

export function createApi(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", cors({ origin: "*", credentials: false }));

  // ---------- Auth middleware ----------
  const requireAuth = async (
    c: import("hono").Context<AppEnv>,
    next: () => Promise<void>,
  ): Promise<Response | void> => {
    const auth = c.req.header("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return c.json({ error: "未登入" }, 401);
    const user = await resolveToken(token);
    if (!user) return c.json({ error: "登入逾期，請重新登入" }, 401);
    c.set("user", user);
    await next();
  };

  // ---------- Public ----------
  app.get("/api/health", (c) => c.json({ ok: true, smtp: smtpConfigured() }));

  app.post("/api/register", async (c) => {
    const body = await c.req.json();
    try {
      const identity: ReporterIdentity = {
        name: body.name,
        contact: body.contact,
        ...(body.nationalId ? { nationalId: body.nationalId } : {}),
      };
      if (!identity.name || !identity.contact) {
        return c.json({ error: "姓名與聯絡方式為必填" }, 400);
      }
      const user = await registerUser({
        username: body.username,
        password: body.password,
        identity,
      });
      const token = await issueToken(user.id);
      await audit({ type: "identity_set", subject: sessionKeyForUser(user.id) });
      return c.json({ token, user: publicUser(user) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post("/api/login", async (c) => {
    const body = await c.req.json();
    const user = await authenticate(body.username, body.password);
    if (!user) return c.json({ error: "帳號或密碼錯誤" }, 401);
    const token = await issueToken(user.id);
    return c.json({ token, user: publicUser(user) });
  });

  app.post("/api/logout", requireAuth, async (c) => {
    const token = c.req.header("Authorization")!.replace(/^Bearer\s+/i, "");
    await revokeToken(token);
    return c.json({ ok: true });
  });

  app.get("/api/me", requireAuth, (c) => c.json({ user: publicUser(c.get("user")) }));

  // ---------- Sessions ----------
  app.post("/api/upload", requireAuth, async (c) => {
    const user = c.get("user");
    if (!tryConsumeAnalysis(numericIdFromHex(user.id))) {
      await audit({ type: "rate_limited", subject: sessionKeyForUser(user.id), meta: { action: "analysis" } });
      return c.json({ error: rateLimitMessage("analysis") }, 429);
    }

    const form = await c.req.formData();
    const files = form.getAll("files");
    const caption = (form.get("caption") as string | null) ?? undefined;
    if (files.length === 0) return c.json({ error: "未提供檔案" }, 400);

    const evidences: MediaEvidence[] = [];
    for (const f of files) {
      if (!(f instanceof File)) continue;
      const buf = Buffer.from(await f.arrayBuffer());
      const suffix = f.type.startsWith("video/") ? "mp4" : "jpg";
      const destPath = join(
        loadConfig().EVIDENCE_DIR,
        `${user.id}-${Date.now()}-${evidences.length}.${suffix}`,
      );
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, buf);
      const exif = await readExif(destPath);
      evidences.push({
        filePath: destPath,
        mimeType: f.type || "image/jpeg",
        capturedAt: exif.capturedAt,
        gps: exif.gps,
        sha256: await sha256(destPath),
        source: "telegram",
        sourceMessageId: 0,
        sourceChatId: 0,
      });
    }

    if (evidences.length === 0) return c.json({ error: "檔案類型不支援" }, 400);

    await audit({
      type: "media_received",
      subject: sessionKeyForUser(user.id),
      meta: { count: evidences.length, sha256: evidences.map((e) => e.sha256) },
    });

    const withGps = evidences.find((e) => e.gps);
    let address: ResolvedAddress | undefined;
    if (withGps?.gps) address = await reverseGeocode(withGps.gps);
    if (!address) {
      address = { full: "（未取得地址，請填入完整地址）", source: "user-input" };
    }

    const analysis = await analyzeMedia(evidences[0]!.filePath, caption);
    await audit({
      type: "analyzed",
      subject: sessionKeyForUser(user.id),
      meta: { category: analysis.category, confidence: analysis.confidence },
    });

    const reportCtx: ReportContext = {
      evidence: evidences,
      analysis,
      address,
      ...(caption ? { userNote: caption } : {}),
      reporter: user.identity,
    };
    const artifact = buildReport(reportCtx);
    await saveSessionByKey(sessionKeyForUser(user.id), {
      ctx: reportCtx,
      artifact,
      attachmentPaths: evidences.map((e) => e.filePath),
      createdAt: Date.now(),
    });
    await audit({
      type: "report_built",
      subject: sessionKeyForUser(user.id),
      meta: { ok: artifact.compliance.ok, issues: artifact.compliance.issues.length },
    });

    return c.json({ ok: true, artifact, evidence: evidences.map(publicEvidence) });
  });

  app.get("/api/session", requireAuth, async (c) => {
    const user = c.get("user");
    const session = await getSessionByKey(sessionKeyForUser(user.id));
    if (!session) return c.json({ session: null });
    return c.json({
      session: {
        artifact: session.artifact,
        evidence: session.ctx.evidence.map(publicEvidence),
        createdAt: session.createdAt,
        pendingSend: session.pendingSend,
      },
    });
  });

  app.post("/api/session/category", requireAuth, async (c) => {
    const user = c.get("user");
    const { category } = (await c.req.json()) as { category: ViolationCategory };
    const session = await getSessionByKey(sessionKeyForUser(user.id));
    if (!session) return c.json({ error: "尚無進行中之檢舉" }, 404);
    const newCtx: ReportContext = {
      ...session.ctx,
      analysis: overrideCategory(session.ctx.analysis, category),
    };
    const artifact = buildReport(newCtx);
    await saveSessionByKey(sessionKeyForUser(user.id), {
      ...session,
      ctx: newCtx,
      artifact,
    });
    return c.json({ ok: true, artifact });
  });

  app.post("/api/session/address", requireAuth, async (c) => {
    const user = c.get("user");
    const { address } = (await c.req.json()) as { address: string };
    const session = await getSessionByKey(sessionKeyForUser(user.id));
    if (!session) return c.json({ error: "尚無進行中之檢舉" }, 404);
    const newCtx: ReportContext = { ...session.ctx, address: parseUserAddress(address) };
    const artifact = buildReport(newCtx);
    await saveSessionByKey(sessionKeyForUser(user.id), { ...session, ctx: newCtx, artifact });
    return c.json({ ok: true, artifact });
  });

  app.post("/api/session/cancel", requireAuth, async (c) => {
    const user = c.get("user");
    await clearSessionByKey(sessionKeyForUser(user.id));
    await audit({ type: "cancelled", subject: sessionKeyForUser(user.id) });
    return c.json({ ok: true });
  });

  app.post("/api/send", requireAuth, async (c) => {
    const user = c.get("user");
    const body = (await c.req.json().catch(() => ({}))) as { to?: string; confirm?: boolean };
    const session = await getSessionByKey(sessionKeyForUser(user.id));
    if (!session) return c.json({ error: "尚無進行中之檢舉" }, 404);
    if (!smtpConfigured()) return c.json({ error: "SMTP 未設定，無法代寄" }, 400);
    if (!session.artifact.compliance.ok) {
      return c.json(
        { error: "尚未通過合規檢查", issues: session.artifact.compliance.issues },
        400,
      );
    }
    if (!body.confirm) {
      const pendingSend: { to?: string } = body.to ? { to: body.to } : {};
      await saveSessionByKey(sessionKeyForUser(user.id), {
        ...session,
        pendingSend,
      });
      await audit({
        type: "send_requested",
        subject: sessionKeyForUser(user.id),
        meta: { to: body.to ?? session.artifact.recipients[0] },
      });
      return c.json({
        pending: true,
        preview: {
          to: body.to ?? session.artifact.recipients[0]!,
          subject: session.artifact.emailSubject,
          attachmentCount: session.attachmentPaths.length,
        },
      });
    }

    if (!tryConsumeSend(numericIdFromHex(user.id))) {
      await audit({ type: "rate_limited", subject: sessionKeyForUser(user.id), meta: { action: "send" } });
      return c.json({ error: rateLimitMessage("send") }, 429);
    }
    await audit({ type: "send_confirmed", subject: sessionKeyForUser(user.id) });
    try {
      const result = await sendReport(
        session.artifact,
        session.attachmentPaths,
        body.to ?? session.pendingSend?.to,
      );
      await audit({
        type: "sent",
        subject: sessionKeyForUser(user.id),
        meta: { messageId: result.messageId },
      });
      await clearSessionByKey(sessionKeyForUser(user.id));
      return c.json({ ok: true, messageId: result.messageId, accepted: result.accepted });
    } catch (err) {
      await audit({
        type: "send_failed",
        subject: sessionKeyForUser(user.id),
        meta: { error: (err as Error).message },
      });
      if (err instanceof MailerNotConfiguredError) {
        return c.json({ error: "SMTP 未設定" }, 400);
      }
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post("/api/lpr", requireAuth, async (c) => {
    const user = c.get("user");
    const form = await c.req.formData();
    const files = form.getAll("files");
    const vehicleTypeHint = (form.get("vehicleTypeHint") as string | null) ?? "Unspecified";
    if (files.length === 0) return c.json({ error: "未提供圖片" }, 400);

    const paths: string[] = [];
    for (const f of files) {
      if (!(f instanceof File)) continue;
      const suffix = f.type.endsWith("png") ? "png" : "jpg";
      const destPath = join(
        loadConfig().EVIDENCE_DIR,
        `${user.id}-lpr-${Date.now()}-${paths.length}.${suffix}`,
      );
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, Buffer.from(await f.arrayBuffer()));
      paths.push(destPath);
    }
    if (paths.length === 0) return c.json({ error: "檔案類型不支援" }, 400);

    try {
      const lpr = await recognizePlate(paths, vehicleTypeHint);
      return c.json({ ok: true, lpr });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get("/api/sms", requireAuth, async (c) => {
    const user = c.get("user");
    const session = await getSessionByKey(sessionKeyForUser(user.id));
    if (!session) return c.json({ error: "尚無進行中之檢舉" }, 404);
    if (!session.artifact.sms) {
      return c.json({ error: "此案件不適用簡訊檢舉（僅交通違停且需已知縣市）" }, 400);
    }
    return c.json({ sms: session.artifact.sms });
  });

  // ---------- Static frontend ----------
  app.get("/", (c) => c.redirect("/index.html"));
  app.use("/*", serveStatic({ root: FRONTEND_DIR }));

  return app;
}

function publicUser(u: UserAccount): { id: string; username: string; identity: ReporterIdentity } {
  return { id: u.id, username: u.username, identity: u.identity };
}

function publicEvidence(e: MediaEvidence): {
  capturedAt?: Date;
  gps?: { lat: number; lon: number };
  sha256: string;
  mimeType: string;
} {
  const out: ReturnType<typeof publicEvidence> = { sha256: e.sha256, mimeType: e.mimeType };
  if (e.capturedAt) out.capturedAt = e.capturedAt;
  if (e.gps) out.gps = e.gps;
  return out;
}

/** Map hex user id to a numeric id for the rate limiter buckets. */
function numericIdFromHex(hex: string): number {
  let n = 0;
  for (let i = 0; i < Math.min(hex.length, 8); i++) {
    n = (n * 31 + hex.charCodeAt(i)) >>> 0;
  }
  return n;
}

export async function startApiServer(port: number): Promise<void> {
  const app = createApi();
  serve({ fetch: app.fetch, port });
  console.log(`✅ Web API listening on http://127.0.0.1:${port}`);
}
