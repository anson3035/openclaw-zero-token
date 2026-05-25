import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10, "TELEGRAM_BOT_TOKEN required"),
  OPENAI_API_KEY: z.string().min(10, "OPENAI_API_KEY required"),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  NOMINATIM_USER_AGENT: z.string().default("taiwan-report-bot/0.1"),
  // TDX (transportdata.tw) credentials — optional. Without these the
  // service operates in anonymous mode (lower rate limit).
  TDX_CLIENT_ID: z.string().optional(),
  TDX_CLIENT_SECRET: z.string().optional(),
  EVIDENCE_DIR: z.string().default("./evidence"),
  DATA_DIR: z.string().default("./data"),
  ALLOWED_USER_IDS: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n))
        : [],
    ),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}

export function resetConfigForTests(): void {
  cached = undefined;
}

export function smtpConfigured(): boolean {
  const c = loadConfig();
  return Boolean(c.SMTP_HOST && c.SMTP_USER && c.SMTP_PASS);
}

export function userAllowed(userId: number): boolean {
  const c = loadConfig();
  if (c.ALLOWED_USER_IDS.length === 0) return true;
  return c.ALLOWED_USER_IDS.includes(userId);
}
