import { describe, expect, it } from "vitest";
import { CONFIG, getModel, validateConfig } from "../../src/llm/config";

const base = () => structuredClone(CONFIG) as unknown as Record<string, unknown> & typeof CONFIG;

describe("models.json", () => {
  it("is valid and lists Claude, OpenAI and Gemini", () => {
    expect(CONFIG.models.map((m) => m.provider)).toEqual(expect.arrayContaining(["anthropic", "openai", "google"]));
    expect(getModel("claude-haiku")?.model).toBe("claude-haiku-4-5");
    expect(CONFIG.fallbackOrder[0]).toBe("claude-sonnet");
    expect(getModel("claude-sonnet")?.effort).toBe("low");
  });
  it("fallbackOrder only names implemented models", () => {
    for (const id of CONFIG.fallbackOrder) expect(getModel(id)?.status).toBe("implemented");
  });
  it("placeholders carry real metadata", () => {
    for (const m of CONFIG.models.filter((x) => x.status === "placeholder")) {
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
  it("requires ordered context warning thresholds (amber 75%, red 90%)", () => {
    expect(CONFIG.contextWarning).toEqual({ amber: 0.75, red: 0.9 });
    const c = base(); c.contextWarning = { amber: 0.9, red: 0.75 };
    expect(() => validateConfig(c)).toThrow(/contextWarning/);
  });
});
