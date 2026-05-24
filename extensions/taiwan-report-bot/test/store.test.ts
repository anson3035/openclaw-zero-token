import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearIdentity,
  clearSession,
  getIdentity,
  getSession,
  saveIdentity,
  saveSession,
} from "../src/services/store.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "trb-store-"));
  process.env.DATA_DIR = dir;
  process.env.TELEGRAM_BOT_TOKEN = "0000000000:test_token_for_unit_tests";
  process.env.OPENAI_API_KEY = "sk-test-unit";
  const cfg = await import("../src/config.js");
  cfg.resetConfigForTests();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("persistent store", () => {
  it("round-trips a session through disk", async () => {
    const chatId = 1234;
    await saveSession(chatId, {
      ctx: {
        evidence: [
          {
            filePath: "/tmp/a.jpg",
            mimeType: "image/jpeg",
            capturedAt: new Date("2026-05-23T10:00:00+08:00"),
            sha256: "d".repeat(64),
            source: "telegram",
            sourceMessageId: 1,
            sourceChatId: chatId,
          },
        ],
        analysis: {
          category: "traffic",
          subject: "違停",
          description: "違停紅線",
          identifiers: { licensePlate: "ABC-1234" },
          confidence: "high",
          evidenceGaps: [],
        },
        address: { full: "台北市信義區", city: "台北市", source: "user-input" },
      },
      artifact: {
        markdown: "x",
        emailSubject: "y",
        emailBody: "z",
        recipients: ["a@b.c"],
        legalCitations: [],
        compliance: { ok: true, issues: [] },
      },
      attachmentPaths: ["/tmp/a.jpg"],
      createdAt: Date.now(),
    });

    const got = await getSession(chatId);
    expect(got).toBeDefined();
    expect(got?.attachmentPaths).toEqual(["/tmp/a.jpg"]);
    expect(got?.ctx.evidence[0]?.capturedAt).toBeInstanceOf(Date);
    expect(got?.ctx.evidence[0]?.sha256).toBe("d".repeat(64));
  });

  it("clears session", async () => {
    const chatId = 999;
    await saveSession(chatId, {
      ctx: {
        evidence: [],
        analysis: {
          category: "traffic",
          subject: "",
          description: "",
          identifiers: {},
          confidence: "low",
          evidenceGaps: [],
        },
        address: { full: "", source: "user-input" },
      },
      artifact: {
        markdown: "",
        emailSubject: "",
        emailBody: "",
        recipients: [],
        legalCitations: [],
        compliance: { ok: true, issues: [] },
      },
      attachmentPaths: [],
      createdAt: Date.now(),
    });
    await clearSession(chatId);
    expect(await getSession(chatId)).toBeUndefined();
  });

  it("round-trips identity", async () => {
    await saveIdentity(42, { name: "李大華", contact: "lee@example.com" });
    const got = await getIdentity(42);
    expect(got?.name).toBe("李大華");
    expect(got?.contact).toBe("lee@example.com");
  });

  it("clears identity", async () => {
    await saveIdentity(42, { name: "李大華", contact: "x" });
    await clearIdentity(42);
    expect(await getIdentity(42)).toBeUndefined();
  });

  it("keeps sessions and identities independent", async () => {
    await saveIdentity(10, { name: "甲", contact: "1" });
    await saveSession(10, {
      ctx: {
        evidence: [],
        analysis: {
          category: "traffic",
          subject: "",
          description: "",
          identifiers: {},
          confidence: "low",
          evidenceGaps: [],
        },
        address: { full: "", source: "user-input" },
      },
      artifact: {
        markdown: "",
        emailSubject: "",
        emailBody: "",
        recipients: [],
        legalCitations: [],
        compliance: { ok: true, issues: [] },
      },
      attachmentPaths: [],
      createdAt: Date.now(),
    });
    await clearSession(10);
    expect(await getIdentity(10)).toBeDefined(); // identity survives session deletion
  });
});
