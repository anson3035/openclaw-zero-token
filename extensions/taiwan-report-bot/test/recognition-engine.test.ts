import { beforeEach, describe, expect, it } from "vitest";
import { RecognitionDispatcher } from "../src/services/recognition-engine/dispatcher.js";
import type {
  PlateRecognizer,
  RecognitionResult,
} from "../src/services/recognition-engine/types.js";

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "0000000000:test_token_long_enough";
  process.env.OPENAI_API_KEY = "sk-test-long-enough-key";
});

/** Synthetic recognizer for testing — no actual API calls. */
function fakeProvider(
  name: string,
  result: Partial<RecognitionResult> & { text: string; confidence: number },
  enabled = true,
): PlateRecognizer {
  return {
    name,
    isEnabled: () => enabled,
    recognize: async () => ({
      status: result.status ?? "success",
      text: result.text,
      confidence: result.confidence,
      latencyMs: result.latencyMs ?? 50,
      provider: name,
      metadata: result.metadata ?? {},
    }),
  };
}

describe("RecognitionDispatcher.dispatch (single provider)", () => {
  it("returns error when no recognizer is enabled", async () => {
    const d = new RecognitionDispatcher().register(
      fakeProvider("a", { text: "ABC-1234", confidence: 0.9 }, false),
    );
    const r = await d.dispatch(["/tmp/x.jpg"]);
    expect(r.status).toBe("error");
    expect(r.provider).toBe("none");
  });

  it("uses the first enabled recognizer", async () => {
    const d = new RecognitionDispatcher()
      .register(fakeProvider("first", { text: "BGM-9090", confidence: 0.9 }))
      .register(fakeProvider("second", { text: "DIFFERENT", confidence: 0.5 }));
    const r = await d.dispatch(["/tmp/x.jpg"]);
    expect(r.text).toBe("BGM-9090");
    expect(r.provider).toBe("first");
  });
});

describe("RecognitionDispatcher.voteDispatch (cross-provider voting)", () => {
  it("degenerates to single dispatch when only 1 provider enabled", async () => {
    const d = new RecognitionDispatcher().register(
      fakeProvider("only", { text: "BGM-9090", confidence: 0.7 }),
    );
    const vote = await d.voteDispatch(["/tmp/x.jpg"]);
    expect(vote.agreement).toBe("single_provider");
    expect(vote.consensus.text).toBe("BGM-9090");
    expect(vote.votes).toHaveLength(1);
  });

  it("boosts confidence × 1.3 when ALL providers agree", async () => {
    const d = new RecognitionDispatcher()
      .register(fakeProvider("a", { text: "BGM-9090", confidence: 0.6 }))
      .register(fakeProvider("b", { text: "BGM-9090", confidence: 0.7 }))
      .register(fakeProvider("c", { text: "BGM-9090", confidence: 0.55 }));
    const vote = await d.voteDispatch(["/tmp/x.jpg"]);
    expect(vote.agreement).toBe("all");
    expect(vote.consensus.text).toBe("BGM-9090");
    // best.confidence was 0.7; × 1.3 = 0.91
    expect(vote.consensus.confidence).toBeCloseTo(0.91, 2);
    expect(vote.consensus.status).toBe("success");
  });

  it("boosts confidence × 1.15 when MAJORITY agree", async () => {
    const d = new RecognitionDispatcher()
      .register(fakeProvider("a", { text: "BGM-9090", confidence: 0.7 }))
      .register(fakeProvider("b", { text: "BGM-9090", confidence: 0.6 }))
      .register(fakeProvider("c", { text: "OTHER", confidence: 0.8 }));
    const vote = await d.voteDispatch(["/tmp/x.jpg"]);
    expect(vote.agreement).toBe("majority");
    expect(vote.consensus.text).toBe("BGM-9090");
    // best in winning group is 0.7; × 1.15 = 0.805
    expect(vote.consensus.confidence).toBeCloseTo(0.805, 2);
  });

  it("penalises × 0.7 when providers SPLIT (no majority)", async () => {
    const d = new RecognitionDispatcher()
      .register(fakeProvider("a", { text: "PLATE-A", confidence: 0.8 }))
      .register(fakeProvider("b", { text: "PLATE-B", confidence: 0.7 }))
      .register(fakeProvider("c", { text: "PLATE-C", confidence: 0.6 }))
      .register(fakeProvider("d", { text: "PLATE-D", confidence: 0.65 }));
    const vote = await d.voteDispatch(["/tmp/x.jpg"]);
    expect(vote.agreement).toBe("split");
    // No majority — picks the winning group (any 1-vote group), penalised × 0.7
    expect(vote.consensus.confidence).toBeLessThan(0.6);
  });

  it("caps boosted confidence at 0.99", async () => {
    const d = new RecognitionDispatcher()
      .register(fakeProvider("a", { text: "X-1234", confidence: 0.95 }))
      .register(fakeProvider("b", { text: "X-1234", confidence: 0.95 }));
    const vote = await d.voteDispatch(["/tmp/x.jpg"]);
    // 0.95 × 1.3 = 1.235 → capped
    expect(vote.consensus.confidence).toBeLessThanOrEqual(0.99);
  });

  it("normalises plate text for comparison (case + whitespace)", async () => {
    const d = new RecognitionDispatcher()
      .register(fakeProvider("a", { text: "bgm-9090", confidence: 0.8 }))
      .register(fakeProvider("b", { text: " BGM-9090 ", confidence: 0.8 }));
    const vote = await d.voteDispatch(["/tmp/x.jpg"]);
    expect(vote.agreement).toBe("all");
  });

  it("returns all_failed when every provider errors out", async () => {
    const d = new RecognitionDispatcher()
      .register(fakeProvider("a", { text: "", confidence: 0, status: "error" }))
      .register(fakeProvider("b", { text: "", confidence: 0, status: "error" }));
    const vote = await d.voteDispatch(["/tmp/x.jpg"]);
    expect(vote.agreement).toBe("all_failed");
  });

  it("returns all_failed when every provider returns empty string", async () => {
    const d = new RecognitionDispatcher()
      .register(fakeProvider("a", { text: "", confidence: 0.1 }))
      .register(fakeProvider("b", { text: "", confidence: 0.1 }));
    const vote = await d.voteDispatch(["/tmp/x.jpg"]);
    expect(vote.agreement).toBe("all_failed");
  });

  it("emits per-provider vote breakdown in metadata", async () => {
    const d = new RecognitionDispatcher()
      .register(fakeProvider("openai", { text: "BGM-9090", confidence: 0.7 }))
      .register(fakeProvider("gemini", { text: "BGM-9090", confidence: 0.65 }));
    const vote = await d.voteDispatch(["/tmp/x.jpg"]);
    expect(vote.consensus.metadata.vote_all_providers).toBeDefined();
    const providers = vote.consensus.metadata.vote_all_providers as Array<{ provider: string }>;
    expect(providers.map((p) => p.provider).sort()).toEqual(["gemini", "openai"]);
  });

  it("ignores disabled providers in vote", async () => {
    const d = new RecognitionDispatcher()
      .register(fakeProvider("a", { text: "BGM-9090", confidence: 0.7 }))
      .register(fakeProvider("b", { text: "BGM-9090", confidence: 0.7 }))
      .register(fakeProvider("c", { text: "OTHER", confidence: 0.99 }, false)); // disabled
    const vote = await d.voteDispatch(["/tmp/x.jpg"]);
    expect(vote.votes).toHaveLength(2);
    expect(vote.agreement).toBe("all");
  });
});
