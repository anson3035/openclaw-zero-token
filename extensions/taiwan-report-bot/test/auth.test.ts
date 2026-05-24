import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "trb-auth-"));
  process.env.DATA_DIR = dir;
  process.env.TELEGRAM_BOT_TOKEN = "0000000000:test_token_for_unit_tests";
  process.env.OPENAI_API_KEY = "sk-test-unit";
  const cfg = await import("../src/config.js");
  cfg.resetConfigForTests();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("auth", () => {
  it("registers and authenticates a user", async () => {
    const { registerUser, authenticate } = await import("../src/services/auth.js");
    const u = await registerUser({
      username: "alice",
      password: "supersecret",
      identity: { name: "王小明", contact: "0912-345678" },
    });
    expect(u.username).toBe("alice");
    expect(u.identity.name).toBe("王小明");
    expect(u.passwordHash).not.toBe("supersecret");

    const verified = await authenticate("alice", "supersecret");
    expect(verified?.id).toBe(u.id);

    const wrong = await authenticate("alice", "wrongpass");
    expect(wrong).toBeUndefined();
  });

  it("rejects short passwords", async () => {
    const { registerUser } = await import("../src/services/auth.js");
    await expect(
      registerUser({
        username: "bob",
        password: "short",
        identity: { name: "x", contact: "y" },
      }),
    ).rejects.toThrow(/8/);
  });

  it("rejects invalid usernames", async () => {
    const { registerUser } = await import("../src/services/auth.js");
    await expect(
      registerUser({
        username: "ab", // too short
        password: "longenoughpass",
        identity: { name: "x", contact: "y" },
      }),
    ).rejects.toThrow();
  });

  it("rejects duplicate usernames", async () => {
    const { registerUser } = await import("../src/services/auth.js");
    await registerUser({
      username: "carol",
      password: "longenoughpass",
      identity: { name: "x", contact: "y" },
    });
    await expect(
      registerUser({
        username: "carol",
        password: "anotherlongpass",
        identity: { name: "y", contact: "z" },
      }),
    ).rejects.toThrow(/已存在/);
  });

  it("issues and resolves tokens", async () => {
    const { registerUser, issueToken, resolveToken, revokeToken } = await import(
      "../src/services/auth.js"
    );
    const u = await registerUser({
      username: "dave",
      password: "longenoughpass",
      identity: { name: "x", contact: "y" },
    });
    const token = await issueToken(u.id);
    const resolved = await resolveToken(token);
    expect(resolved?.id).toBe(u.id);

    await revokeToken(token);
    expect(await resolveToken(token)).toBeUndefined();
  });

  it("session key namespaces users", async () => {
    const { sessionKeyForUser } = await import("../src/services/auth.js");
    expect(sessionKeyForUser("abc123")).toBe("user:abc123");
  });
});
