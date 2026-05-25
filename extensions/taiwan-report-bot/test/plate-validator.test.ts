import { describe, expect, it } from "vitest";
import { validatePlate } from "../src/services/plate-validator.js";

describe("validatePlate (MOTC issuance rules)", () => {
  // ---- Modern 7-character (3 letters + 4 digits) ----
  it("accepts a standard modern 7-char plate", () => {
    const r = validatePlate("BGM-9090");
    expect(r.valid).toBe(true);
    expect(r.format).toBe("modern-7");
    expect(r.reasons).toEqual([]);
  });

  it("normalizes case before validating", () => {
    expect(validatePlate("bgm-9090").valid).toBe(true);
  });

  it("rejects modern 7-char plate with digit-4 in numeric section", () => {
    const r = validatePlate("BGM-9040");
    expect(r.valid).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/'4' which is excluded/);
  });

  it("rejects modern 7-char plate with letter I", () => {
    const r = validatePlate("BIM-9090");
    expect(r.valid).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/'I' or 'O'/);
  });

  it("rejects modern 7-char plate with letter O", () => {
    expect(validatePlate("BOM-9090").valid).toBe(false);
  });

  // ---- Special prefixes (use no-4 digit sequences to satisfy modern-7 rule) ----
  it("detects EV prefix", () => {
    const r = validatePlate("EAB-1235");
    expect(r.valid).toBe(true);
    expect(r.special).toBe("ev");
  });

  it("detects rental-EV prefix", () => {
    const r = validatePlate("REA-1235");
    expect(r.valid).toBe(true);
    expect(r.special).toBe("rental-ev");
  });

  it("detects taxi prefix (T)", () => {
    const r = validatePlate("TPE-1235");
    expect(r.valid).toBe(true);
    expect(r.special).toBe("taxi");
  });

  // ---- Older 6-character ----
  it("accepts older 2L-4D format", () => {
    const r = validatePlate("AB-1234");
    expect(r.valid).toBe(true);
    expect(r.format).toBe("old-6a");
  });

  it("accepts older 4D-2L format", () => {
    const r = validatePlate("1234-AB");
    expect(r.valid).toBe(true);
    expect(r.format).toBe("old-6b");
  });

  it("allows digit-4 in older 6-character plates (rule only modern 7)", () => {
    expect(validatePlate("AB-1234").valid).toBe(true);
    expect(validatePlate("4321-AB").valid).toBe(true);
  });

  // ---- Motorcycle ----
  it("accepts motorcycle 3L-3D", () => {
    const r = validatePlate("ABC-123");
    expect(r.valid).toBe(true);
    expect(r.format).toBe("motorcycle-3l3d");
  });

  it("accepts motorcycle 2L-3D", () => {
    const r = validatePlate("AB-123");
    expect(r.valid).toBe(true);
    expect(r.format).toBe("motorcycle-2l3d");
  });

  // ---- Malformed ----
  it("rejects plates without dash", () => {
    expect(validatePlate("BGM9090").valid).toBe(false);
  });

  it("rejects plates with unsupported length", () => {
    expect(validatePlate("ABCDE-12345").valid).toBe(false);
  });

  it("rejects plates with garbage characters", () => {
    expect(validatePlate("B?M-9090").valid).toBe(false);
  });

  it("accumulates multiple reasons when applicable", () => {
    const r = validatePlate("BIO-9040");
    expect(r.valid).toBe(false);
    expect(r.reasons.length).toBeGreaterThanOrEqual(1);
    expect(r.reasons.join(" ")).toMatch(/I/);
  });
});
