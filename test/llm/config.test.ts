import { describe, expect, it } from "vitest";
import { CONFIG, getModel, validateConfig } from "../../src/llm/config";

const base = () => structuredClone(CONFIG) as unknown as Record<string, unknown> & typeof CONFIG;

describe("models.json", () => {
  it("is valid and lists Claude, OpenAI and Gemini", () => {
    expect(CONFIG.models.map((m) => m.provider)).toEqual(expect.arrayContaining(["anthropic", "openai", "google"]));
  });
  it("pins the binding Claude values", () => {
    expect(getModel("claude-sonnet")).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5", contextWindow: 1_000_000,
      pricePerMTok: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, effort: "low", status: "implemented" });
    expect(getModel("claude-haiku")).toMatchObject({ provider: "anthropic", model: "claude-haiku-4-5", contextWindow: 200_000,
      pricePerMTok: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, status: "implemented",
      description: "Claude's smallest model. The last backup." });
    expect(getModel("claude-haiku")).not.toHaveProperty("effort");   // Haiku rejects the effort parameter
  });
  it("pins Gemini 3.5 Flash-Lite as the implemented cross-provider backup", () => {
    expect(getModel("gemini-flash-lite")).toEqual({
      id: "gemini-flash-lite", provider: "google", providerLabel: "Google",
      model: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite",
      description: "Google's fast, low-cost model. The cross-provider backup.",
      contextWindow: 1_048_576, outputTokenLimit: 65_536,
      pricePerMTok: { input: 0.3, output: 2.5, cacheRead: 0.03 }, status: "implemented" });
    expect(getModel("gemini")).toBeUndefined();   // the old placeholder id is gone
  });
  it("falls back across providers: Sonnet, then Gemini, then Haiku", () => {
    expect(CONFIG.fallbackOrder).toEqual(["claude-sonnet", "gemini-flash-lite", "claude-haiku"]);
  });
  it("fallbackOrder only names implemented models", () => {
    for (const id of CONFIG.fallbackOrder) expect(getModel(id)?.status).toBe("implemented");
  });
  it("lists models in priority order: the fallback chain, then placeholders (the dropdown shows this order)", () => {
    const placeholders = CONFIG.models.filter((m) => m.status === "placeholder").map((m) => m.id);
    expect(CONFIG.models.map((m) => m.id)).toEqual([...CONFIG.fallbackOrder, ...placeholders]);
  });
  it("labels providers by company", () => {
    expect(CONFIG.models.map((m) => m.providerLabel)).toEqual(["Anthropic", "Google", "Anthropic", "OpenAI"]);
  });
  it("OpenAI is the only placeholder, and it carries real metadata", () => {
    const placeholders = CONFIG.models.filter((x) => x.status === "placeholder");
    expect(placeholders.map((m) => m.id)).toEqual(["openai"]);
    for (const m of placeholders) {
      expect(m.model).not.toMatch(/[<>]/);
      expect(m.contextWindow).toBeGreaterThan(0);
      expect(m.pricePerMTok.input).toBeGreaterThan(0);
    }
  });
});

describe("validateConfig", () => {
  it("rejects duplicate ids", () => {
    const c = base(); c.models = [...c.models, c.models[0]];
    expect(() => validateConfig(c)).toThrow(/duplicate model id/);
  });
  it("rejects unknown ids in fallbackOrder", () => {
    const c = base(); c.fallbackOrder = ["nope"];
    expect(() => validateConfig(c)).toThrow(/fallbackOrder/);
  });
  it("rejects non-positive prices on implemented models", () => {
    const c = base(); c.models[0] = { ...c.models[0], pricePerMTok: { input: 0, output: 5 } };
    expect(() => validateConfig(c)).toThrow(/price/);
  });
  it("rejects a non-positive outputTokenLimit", () => {
    const c = base(); c.models[0] = { ...c.models[0], outputTokenLimit: 0 };
    expect(() => validateConfig(c)).toThrow(/outputTokenLimit/);
  });
  it("requires ordered context warning thresholds (amber 75%, red 90%)", () => {
    expect(CONFIG.contextWarning).toEqual({ amber: 0.75, red: 0.9 });
    const c = base(); c.contextWarning = { amber: 0.9, red: 0.75 };
    expect(() => validateConfig(c)).toThrow(/contextWarning/);
  });
});
