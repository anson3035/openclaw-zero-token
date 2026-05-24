import { describe, expect, it, beforeEach } from "vitest";
import { buildLprPrompt, lprResultSchema } from "../src/services/lpr.js";

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "0000000000:test_token_long_enough";
  process.env.OPENAI_API_KEY = "sk-test-long-enough-key";
});

describe("buildLprPrompt", () => {
  it("enforces Taiwan plate rules in the prompt", () => {
    const p = buildLprPrompt();
    expect(p).toContain("'I'");
    expect(p).toContain("'O'");
    expect(p).toContain("never used in any Taiwanese license plate".toLowerCase().includes("never")
      ? "NEVER used"
      : "");
    expect(p).toContain("EV");
    expect(p).toContain("Modern 7-Character");
    expect(p).toContain("Older 6-Character");
    expect(p).toContain("Motorcycle");
  });

  it("instructs strict JSON output (no markdown wrapping)", () => {
    const p = buildLprPrompt();
    expect(p).toMatch(/STRICT JSON ONLY/i);
    expect(p).toMatch(/Do not wrap the JSON in markdown/i);
  });

  it("includes Chain-of-Thought stages: localization, artifacts, cross-frame, syntax", () => {
    const p = buildLprPrompt();
    expect(p).toContain("Localization");
    expect(p).toContain("Visual Artifact Analysis");
    expect(p).toContain("Cross-Frame Verification");
    expect(p).toContain("Syntax Correction");
  });

  it("interpolates the vehicleTypeHint", () => {
    expect(buildLprPrompt("Sedan")).toContain("Sedan");
    expect(buildLprPrompt("MPV")).toContain("MPV");
    expect(buildLprPrompt()).toContain("Unspecified");
  });

  it("explicitly excludes the digit 4 from modern 7-char plates", () => {
    const p = buildLprPrompt();
    expect(p).toMatch(/number\s+\*\*'4'\*\*\s+is entirely excluded/);
  });
});

describe("lprResultSchema", () => {
  const sample = {
    analysis: {
      localization_success: true,
      detected_artifacts: ["motion_blur", "glare"],
      plate_type: "Modern 7-Character",
      raw_visual_text: "BEA9210",
    },
    resolved_plate: {
      license_plate_number: "BEA-9210",
      confidence_score: 0.92,
      is_ambiguous: false,
      ambiguity_details: "",
    },
  };

  it("accepts a well-formed LPR result", () => {
    expect(() => lprResultSchema.parse(sample)).not.toThrow();
  });

  it("accepts a partially illegible plate with '?' placeholders", () => {
    const partial = {
      ...sample,
      resolved_plate: {
        ...sample.resolved_plate,
        license_plate_number: "AB?-1235",
        is_ambiguous: true,
        ambiguity_details: "Third character occluded by screw.",
      },
    };
    expect(() => lprResultSchema.parse(partial)).not.toThrow();
  });

  it("rejects confidence outside 0..1", () => {
    const bad = {
      ...sample,
      resolved_plate: { ...sample.resolved_plate, confidence_score: 1.5 },
    };
    expect(() => lprResultSchema.parse(bad)).toThrow();
  });

  it("rejects missing fields", () => {
    expect(() => lprResultSchema.parse({})).toThrow();
    expect(() => lprResultSchema.parse({ analysis: sample.analysis })).toThrow();
  });

  it("requires detected_artifacts to be an array of strings", () => {
    const bad = {
      ...sample,
      analysis: { ...sample.analysis, detected_artifacts: "glare" },
    };
    expect(() => lprResultSchema.parse(bad)).toThrow();
  });
});

describe("video module surface", () => {
  it("isVideoPath identifies common video extensions", async () => {
    const { isVideoPath } = await import("../src/services/video.js");
    expect(isVideoPath("clip.mp4")).toBe(true);
    expect(isVideoPath("clip.MOV")).toBe(true);
    expect(isVideoPath("clip.webm")).toBe(true);
    expect(isVideoPath("video/mp4")).toBe(true);
    expect(isVideoPath("photo.jpg")).toBe(false);
    expect(isVideoPath("image/png")).toBe(false);
  });
});
