import nodemailer from "nodemailer";
import { loadConfig, smtpConfigured } from "../config.js";
import type { ReportArtifact } from "../types.js";

export class MailerNotConfiguredError extends Error {
  constructor() {
    super("SMTP not configured: set SMTP_HOST/SMTP_USER/SMTP_PASS in .env to enable /send");
  }
}

export async function sendReport(
  artifact: ReportArtifact,
  attachmentPaths: string[],
  overrideRecipient?: string,
): Promise<{ messageId: string; accepted: string[] }> {
  if (!smtpConfigured()) throw new MailerNotConfiguredError();
  const cfg = loadConfig();

  const transporter = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT ?? 587,
    secure: cfg.SMTP_SECURE,
    auth: { user: cfg.SMTP_USER!, pass: cfg.SMTP_PASS! },
  });

  const to = overrideRecipient ?? artifact.recipients[0]!;
  const info = await transporter.sendMail({
    from: cfg.SMTP_FROM ?? cfg.SMTP_USER!,
    to,
    subject: artifact.emailSubject,
    text: artifact.emailBody,
    attachments: attachmentPaths.map((p) => ({ path: p })),
  });

  return {
    messageId: info.messageId,
    accepted: info.accepted.map(String),
  };
}
