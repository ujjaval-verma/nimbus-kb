import { expect, it } from "vitest";
import { SECTIONS } from "../../src/kb";
import { CONFIG } from "../../src/llm/config";
import { CHARS_PER_TOKEN, estimateTokens, fitToWindow, historyBudget, MAX_OUTPUT_TOKENS } from "../../src/llm/context";
import { buildSystemPrompt } from "../../src/llm/prompt";

const u = (content: string) => ({ role: "user" as const, content });
const a = (content: string) => ({ role: "assistant" as const, content });

it("estimates conservatively", () => {
  expect(estimateTokens("")).toBe(0);
  expect(estimateTokens("abcd")).toBe(Math.ceil(4 / CHARS_PER_TOKEN));
});

it("keeps the newest turns within budget, always keeps the question, and starts on a user turn", () => {
  const msgs = [u("a".repeat(30)), a("b".repeat(300)), u("c")];
  expect(fitToWindow(msgs, 20)).toEqual({ messages: [u("c")], dropped: 2 });
  expect(fitToWindow(msgs, 1000)).toEqual({ messages: msgs, dropped: 0 });
  expect(fitToWindow([u("x".repeat(999))], 1).messages).toHaveLength(1);
});

it("budgets per model from its context window", () => {
  const sonnet = CONFIG.models.find((m) => m.id === "claude-sonnet")!;
  expect(historyBudget(sonnet, 4000)).toBe(Math.floor(1_000_000 * 0.95) - 4000);
  // real room left for the reply even when history is at the cap (real tokens are about 3/4 of the estimate)
  for (const m of CONFIG.models.filter((x) => x.status === "implemented")) expect(m.contextWindow * 0.95 * 0.75 + MAX_OUTPUT_TOKENS).toBeLessThan(m.contextWindow);
});

it("the whole knowledge base stays a small share of every implemented model's window (else revisit decisions.md section 1)", () => {
  const systemTokens = estimateTokens(buildSystemPrompt(SECTIONS));
  const smallest = Math.min(...CONFIG.models.filter((m) => m.status === "implemented").map((m) => m.contextWindow));
  expect(systemTokens / smallest, "The knowledge base has outgrown whole-corpus prompting. See docs/decisions.md section 1.").toBeLessThan(0.25);
});

it("drops a leading assistant message after a trim so history starts on a user turn", () => {
  const msgs = [u("a".repeat(300)), a("b"), u("c"), a("d"), u("e")];
  // budget fits the last three turns plus the assistant before them is cut by the user-start rule
  const r = fitToWindow(msgs, 4);
  expect(r.messages[0].role).toBe("user");
  expect(r.messages).toEqual([u("c"), a("d"), u("e")]);
  expect(r.dropped).toBe(2);
});
