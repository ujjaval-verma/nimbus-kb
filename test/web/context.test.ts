import { expect, it } from "vitest";
import { contextUsage } from "../../src/web/context";
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
