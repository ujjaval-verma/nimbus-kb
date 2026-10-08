import { expect, it } from "vitest";
import { publicContextWindow } from "../../src/llm/context";
import { contextUsage, effectiveWindow, meterModel } from "../../src/web/context";
import type { Turn } from "../../src/web/session";

const thresholds = { amber: 0.75, red: 0.9 };
const modelTurn = (tokens: number): Turn => ({ id: "1", question: "q", answer: "a", status: "done", failed: [],
  done: { type: "done", answeredBy: "claude-sonnet", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0, passages: [], invalidRefCount: 0, uncited: false, contextTokens: tokens, notices: [] } });

it("starts from the system prompt alone", () => {
  const u = contextUsage({ turns: [], contextWindow: 200_000, systemPromptTokens: 4_000, thresholds });
  expect(u).toEqual({ tokens: 4_000, ratio: 0.02, level: "ok" });
});

it("uses the last model reply's context count (trimming units), plus estimates for turns after it", () => {
  expect(contextUsage({ turns: [modelTurn(160_000)], contextWindow: 1_000_000, systemPromptTokens: 4_000, thresholds }).tokens).toBe(160_000);
  const later: Turn = { id: "3", question: "q".repeat(300), answer: "a".repeat(300), status: "done", failed: [] };   // sources-only, no model usage
  expect(contextUsage({ turns: [modelTurn(10_000), later], contextWindow: 1_000_000, systemPromptTokens: 4_000, thresholds }).tokens).toBe(10_200);
});

it("switching to a smaller window updates the level immediately (E7)", () => {
  const turns = [modelTurn(160_000)];
  expect(contextUsage({ turns, contextWindow: 1_000_000, systemPromptTokens: 4_000, thresholds }).level).toBe("ok");
  expect(contextUsage({ turns, contextWindow: 200_000, systemPromptTokens: 4_000, thresholds }).level).toBe("amber");   // 80%
  expect(contextUsage({ turns: [modelTurn(185_000)], contextWindow: 200_000, systemPromptTokens: 4_000, thresholds }).level).toBe("red");
});

it("a reply at the trimming cap (95% of the window) reads red, so warnings always come before trimming", () => {
  expect(contextUsage({ turns: [modelTurn(190_000)], contextWindow: 200_000, systemPromptTokens: 4_000, thresholds }).level).toBe("red");
});

it("estimates from text when there is no model usage (sources-only turns)", () => {
  const t: Turn = { id: "2", question: "q".repeat(3000), answer: "a".repeat(3000), status: "done", failed: [] };
  expect(contextUsage({ turns: [t], contextWindow: 200_000, systemPromptTokens: 0, thresholds }).tokens).toBe(2_000);
});

it("meters against the first available model in [selected, ...fallbackOrder]", () => {
  const m = (id: string, available: boolean) => ({ id, available }) as never;
  const models = [m("openai", false), m("sonnet", true), m("haiku", true)];
  expect(meterModel(models, "openai", ["sonnet", "haiku"]).id).toBe("sonnet");
  expect(meterModel(models, "haiku", ["sonnet", "haiku"]).id).toBe("haiku");
  expect(meterModel([m("a", false)], "a", ["a"]).id).toBe("a");
});

it("on the public site the meter uses the capped window, so amber and red come before trimming", () => {
  const cap = publicContextWindow(4_000, 20_000);
  expect(effectiveWindow(1_000_000, cap)).toBe(cap);
  expect(effectiveWindow(1_000_000, null)).toBe(1_000_000);
  expect(effectiveWindow(20_000, cap)).toBe(20_000);   // a smaller real window still wins
  const w = effectiveWindow(1_000_000, cap);
  expect(contextUsage({ turns: [modelTurn(19_000)], contextWindow: w, systemPromptTokens: 4_000, thresholds }).level).toBe("amber");
  expect(contextUsage({ turns: [modelTurn(24_000)], contextWindow: w, systemPromptTokens: 4_000, thresholds }).level).toBe("red");   // 24,000 = system + 20,000: trimming starts here
});

it("falls back to the smallest implemented window, whatever the list order", () => {
  const m = (id: string, contextWindow: number, status = "implemented") => ({ id, available: false, contextWindow, status }) as never;
  const models = [m("sonnet", 1_000_000), m("haiku", 200_000), m("openai", 50_000, "placeholder")];
  expect(meterModel(models, "missing", []).id).toBe("haiku");
});
