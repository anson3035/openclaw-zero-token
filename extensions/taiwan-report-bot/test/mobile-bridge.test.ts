/**
 * Smoke tests for mobile-bridge.js — verifies the file structure +
 * function names exist as expected. Real device-level testing happens
 * in the iOS / Android build pipelines.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BRIDGE = resolve(
  import.meta.dirname,
  "..",
  "mobile",
  "scripts",
  "mobile-bridge.js",
);

describe("mobile-bridge.js — Capacitor 整合", () => {
  it("檔案存在", async () => {
    const src = await readFile(BRIDGE, "utf8");
    expect(src.length).toBeGreaterThan(1000);
  });

  it("匯出全部 MobileBridge API", async () => {
    const src = await readFile(BRIDGE, "utf8");
    const required = [
      "takePhoto",
      "getCurrentPosition",
      "share",
      "setSecure",
      "getSecure",
      "removeSecure",
      "getNetworkStatus",
      "apiBase",
      "isNative",
    ];
    for (const fn of required) {
      expect(src).toContain(fn);
    }
  });

  it("正確 fallback 到 web API 當非 native 環境", async () => {
    const src = await readFile(BRIDGE, "utf8");
    expect(src).toContain("navigator.geolocation");
    expect(src).toContain("navigator.share");
    expect(src).toMatch(/input\.type = "file"/);
  });

  it("正確檢測 Capacitor 平台", async () => {
    const src = await readFile(BRIDGE, "utf8");
    expect(src).toContain("window.Capacitor");
    expect(src).toContain("isNativePlatform");
  });

  it("重寫 fetch 加上 API base URL prefix", async () => {
    const src = await readFile(BRIDGE, "utf8");
    expect(src).toContain('input.startsWith("/api/")');
    expect(src).toContain("origFetch(apiBase + input");
  });

  it("提供 settings UI", async () => {
    const src = await readFile(BRIDGE, "utf8");
    expect(src).toContain("trb-settings-btn");
    expect(src).toContain("openSettings");
    expect(src).toContain("trb.apiBase");
  });
});

describe("capacitor.config.ts — App 設定", () => {
  const CONFIG = resolve(
    import.meta.dirname,
    "..",
    "mobile",
    "capacitor.config.ts",
  );

  it("appId 為反向 DNS 格式", async () => {
    const src = await readFile(CONFIG, "utf8");
    expect(src).toMatch(/appId:\s*"[a-z]+\.[a-z]+\.[a-z-]+"/);
  });

  it("webDir 指向 www", async () => {
    const src = await readFile(CONFIG, "utf8");
    expect(src).toContain('webDir: "www"');
  });

  it("Camera/Geolocation 包含 iOS 權限描述", async () => {
    const src = await readFile(CONFIG, "utf8");
    expect(src).toContain("cameraDescription");
    expect(src).toContain("locationDescription");
  });

  it("Android allowMixedContent 開啟（LAN HTTP）", async () => {
    const src = await readFile(CONFIG, "utf8");
    expect(src).toContain("allowMixedContent: true");
  });
});

describe("build-www.sh — 建置腳本", () => {
  const SCRIPT = resolve(
    import.meta.dirname,
    "..",
    "mobile",
    "scripts",
    "build-www.sh",
  );

  it("為 bash 腳本", async () => {
    const src = await readFile(SCRIPT, "utf8");
    expect(src.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("注入 mobile-bridge.js 到 index.html", async () => {
    const src = await readFile(SCRIPT, "utf8");
    expect(src).toContain("mobile-bridge.js");
    expect(src).toContain("app.js");
  });

  it("複製 web/ 到 www/", async () => {
    const src = await readFile(SCRIPT, "utf8");
    expect(src).toContain('cp -r "$SRC"');
  });
});
