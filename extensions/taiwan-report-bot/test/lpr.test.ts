import { describe, expect, it, beforeEach } from "vitest";
import { buildLprPrompt, lprResultSchema } from "../src/services/lpr.js";

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "0000000000:test_token_long_enough";
  process.env.OPENAI_API_KEY = "sk-test-long-enough-key";
});

describe("buildLprPrompt (v2)", () => {
  it("enforces Taiwan plate rules (I/O exclusion, digit-4 exclusion)", () => {
    const p = buildLprPrompt();
    expect(p).toContain("'I'");
    expect(p).toContain("'O'");
    expect(p).toContain("NEVER used");
    expect(p).toContain("'4'");
    expect(p).toMatch(/digit\s+\*\*'4'\*\*\s+is excluded/);
  });

  it("instructs strict JSON output (no markdown wrapping)", () => {
    const p = buildLprPrompt();
    expect(p).toMatch(/STRICT JSON ONLY/i);
    expect(p).toMatch(/no markdown/i);
  });

  it("forces top-3 candidate enumeration and per-character analysis", () => {
    const p = buildLprPrompt();
    expect(p).toContain("Top-3 hypothesis enumeration");
    expect(p).toContain("per_character");
    expect(p).toContain("candidates");
  });

  it("declares confusion table with explicit visually-confusable pairs", () => {
    const p = buildLprPrompt();
    expect(p).toContain("visually-confusable character pairs");
    expect(p).toMatch(/G\s+↔/);
    expect(p).toMatch(/M\s+↔/);
    expect(p).toMatch(/0\s+↔/);
    expect(p).toMatch(/8\s+↔/);
  });

  it("includes capture-quality scoring step (anti-hallucination)", () => {
    const p = buildLprPrompt();
    expect(p).toContain("Capture-quality scoring");
    expect(p).toContain("capture_quality");
    expect(p).toContain("upper cap on confidence");
  });

  it("warns against fake cross-frame agreement (same-bias trap)", () => {
    const p = buildLprPrompt();
    expect(p).toContain("Cross-frame fusion");
    expect(p).toMatch(/your own bias agreeing with itself/);
  });

  it("declares the requires_human_verification trigger conditions", () => {
    const p = buildLprPrompt();
    expect(p).toContain("requires_human_verification=true if");
    expect(p).toContain("confidence < 0.85");
  });

  it("interpolates the vehicleTypeHint", () => {
    expect(buildLprPrompt("Sedan")).toContain("Sedan");
    expect(buildLprPrompt("MPV")).toContain("MPV");
    expect(buildLprPrompt()).toContain("Unspecified");
  });

  it("contains honesty rules instructing against confidence inflation", () => {
    const p = buildLprPrompt();
    expect(p).toContain("Honesty Rules");
    expect(p).toMatch(/DO NOT inflate confidence/);
  });
});

describe("lprResultSchema (v2)", () => {
  const fullSample = {
    analysis: {
      localization_success: true,
      detected_artifacts: ["distance", "angle_distortion"],
      capture_quality: 0.42,
      plate_type: "Modern 7-Character",
      raw_visual_text: "BGM9090",
      per_character: [
        { position: 1, primary: "B", alternatives: ["8"], confidence: 0.95 },
        { position: 2, primary: "G", alternatives: ["E", "C", "6"], confidence: 0.55 },
        { position: 3, primary: "M", alternatives: ["N", "H"], confidence: 0.60 },
        { position: 4, primary: "9", alternatives: ["0"], confidence: 0.85 },
        { position: 5, primary: "0", alternatives: ["8", "6"], confidence: 0.75 },
        { position: 6, primary: "9", alternatives: [], confidence: 0.90 },
        { position: 7, primary: "0", alternatives: [], confidence: 0.90 },
      ],
    },
    candidates: [
      { license_plate_number: "BGM-9090", joint_confidence: 0.42, reasoning: "primary picks" },
      { license_plate_number: "BEM-9090", joint_confidence: 0.18, reasoning: "G→E alternative" },
      { license_plate_number: "BGN-9090", joint_confidence: 0.12, reasoning: "M→N alternative" },
    ],
    resolved_plate: {
      license_plate_number: "BGM-9090",
      confidence_score: 0.42,
      is_ambiguous: true,
      ambiguity_details: "Positions 2 & 3 below 0.85 individual confidence.",
      requires_human_verification: true,
    },
  };

  it("accepts a full v2 response with candidates + per-character data", () => {
    expect(() => lprResultSchema.parse(fullSample)).not.toThrow();
  });

  it("treats candidates and per_character as optional (backward compat)", () => {
    const minimal = {
      analysis: {
        localization_success: true,
        detected_artifacts: [],
        plate_type: "Modern 7-Character",
        raw_visual_text: "AAA-1234",
      },
      resolved_plate: {
        license_plate_number: "AAA-1234",
        confidence_score: 0.95,
        is_ambiguous: false,
        ambiguity_details: "",
      },
    };
    expect(() => lprResultSchema.parse(minimal)).not.toThrow();
  });

  it("rejects confidence outside 0..1", () => {
    const bad = {
      ...fullSample,
      resolved_plate: { ...fullSample.resolved_plate, confidence_score: 1.5 },
    };
    expect(() => lprResultSchema.parse(bad)).toThrow();
  });

  it("rejects per-character entries with bad shape", () => {
    const bad = {
      ...fullSample,
      analysis: {
        ...fullSample.analysis,
        per_character: [{ position: "first", primary: "B", alternatives: [], confidence: 0.9 }],
      },
    };
    expect(() => lprResultSchema.parse(bad)).toThrow();
  });

  it("rejects candidates with bad joint_confidence range", () => {
    const bad = {
      ...fullSample,
      candidates: [
        { license_plate_number: "BGM-9090", joint_confidence: 2.5, reasoning: "" },
      ],
    };
    expect(() => lprResultSchema.parse(bad)).toThrow();
  });
});

describe("confidence-cap behavior (recognizePlate's post-hoc reducer)", () => {
  // We can't easily test recognizePlate() without mocking OpenAI, but we can
  // verify the schema accepts the shapes the cap function relies on, and that
  // the contract is enforced. The post-hoc cap itself is verified via the
  // integration with the bot flow (manual / e2e).
  it("schema requires confidence_score in 0..1 and accepts capture_quality", () => {
    expect(() =>
      lprResultSchema.parse({
        analysis: {
          localization_success: true,
          detected_artifacts: ["distance", "angle_distortion", "low_resolution"],
          capture_quality: 0.3,
          plate_type: "Modern 7-Character",
          raw_visual_text: "BGM9090",
        },
        resolved_plate: {
          license_plate_number: "BGM-9090",
          confidence_score: 0.35,
          is_ambiguous: true,
          ambiguity_details: "low capture quality",
          requires_human_verification: true,
        },
      }),
    ).not.toThrow();
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
