import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "trb-api-"));
  process.env.DATA_DIR = dir;
  process.env.EVIDENCE_DIR = join(dir, "evidence");
  process.env.TELEGRAM_BOT_TOKEN = "0000000000:test_token_for_unit_tests";
  process.env.OPENAI_API_KEY = "sk-test-unit";
  const cfg = await import("../src/config.js");
  cfg.resetConfigForTests();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function newApp() {
  const { createApi } = await import("../src/api/server.js");
  return createApi();
}

describe("API", () => {
  it("returns health status without auth", async () => {
    const app = await newApp();
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("rejects protected routes without bearer token", async () => {
    const app = await newApp();
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
  });

  it("registers, logs in, and accesses /api/me", async () => {
    const app = await newApp();
    const reg = await app.request("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "alice",
        password: "supersecret123",
        name: "王小明",
        contact: "0912-345678",
      }),
    });
    expect(reg.status).toBe(200);
    const { token } = await reg.json();

    const me = await app.request("/api/me", { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expect(meBody.user.username).toBe("alice");
    expect(meBody.user.identity.name).toBe("王小明");
  });

  it("rejects duplicate registration", async () => {
    const app = await newApp();
    const body = JSON.stringify({
      username: "bob",
      password: "supersecret123",
      name: "x",
      contact: "y",
    });
    await app.request("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const dup = await app.request("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(dup.status).toBe(400);
  });

  it("rejects bad login", async () => {
    const app = await newApp();
    const res = await app.request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "nope", password: "nope" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns null session for fresh user", async () => {
    const app = await newApp();
    const reg = await app.request("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "carol",
        password: "supersecret123",
        name: "x",
        contact: "y",
      }),
    });
    const { token } = await reg.json();
    const s = await app.request("/api/session", { headers: { Authorization: `Bearer ${token}` } });
    expect(s.status).toBe(200);
    const body = await s.json();
    expect(body.session).toBeNull();
  });

  it("requires identity fields on registration", async () => {
    const app = await newApp();
    const res = await app.request("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "dave", password: "supersecret123" }),
    });
    expect(res.status).toBe(400);
  });

  it("logout revokes the token", async () => {
    const app = await newApp();
    const reg = await app.request("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "erin",
        password: "supersecret123",
        name: "x",
        contact: "y",
      }),
    });
    const { token } = await reg.json();
    const logout = await app.request("/api/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logout.status).toBe(200);
    const me = await app.request("/api/me", { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status).toBe(401);
  });
});
