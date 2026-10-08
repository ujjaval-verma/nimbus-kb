import { describe, expect, it } from "vitest";
import { SECTIONS } from "../../src/kb";
import { CONFIG } from "../../src/llm/config";
import { CHARS_PER_TOKEN, estimateTokens, fitPublic, fitToWindow, historyBudget, MAX_OUTPUT_TOKENS, PUBLIC_MESSAGE_OVERHEAD, publicTokens } from "../../src/llm/context";
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
  // Real room left for the reply even when history is at the cap. Measured: the system prompt is 6,369 real Claude tokens.
  const realPerEstimate = 6369 / estimateTokens(buildSystemPrompt(SECTIONS));
  expect(realPerEstimate).toBeLessThan(1);   // the estimate overcounts Claude on this content
  for (const m of CONFIG.models.filter((x) => x.status === "implemented")) expect(m.contextWindow * 0.95 * realPerEstimate + MAX_OUTPUT_TOKENS).toBeLessThan(m.contextWindow);
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

describe("fitPublic (the public site's hard history bound)", () => {
  it("measures UTF-8 bytes, so multi-byte text cannot slip past the cap", () => {
    const cjk = "漢".repeat(25_000);   // 25,000 UTF-16 units (estimate 8,334) but 75,000 bytes (25,000 public tokens)
    expect(estimateTokens(cjk)).toBeLessThan(20_000);
    expect(publicTokens(cjk)).toBe(25_000 + PUBLIC_MESSAGE_OVERHEAD);
    expect(publicTokens("😀")).toBe(2 + PUBLIC_MESSAGE_OVERHEAD);   // 4 bytes
    const r = fitPublic([u("Compare all products"), a(cjk), u("and its SLA?")], 20_000, 40);
    expect(r).toEqual({ messages: [u("and its SLA?")], dropped: 2 });
  });

  it("counts a per-message overhead and caps the number of messages, oldest first", () => {
    const many = Array.from({ length: 101 }, (_, i) => (i % 2 === 0 ? u("a") : a("b")));
    const r = fitPublic(many, 20_000, 40);
    expect(r.messages.length).toBeLessThanOrEqual(40);
    expect(r.messages[0].role).toBe("user");
    expect(r.messages.at(-1)).toBe(many.at(-1));
    expect(r.dropped).toBe(101 - r.messages.length);
    // The overhead alone trims: 10 tiny messages cost 10 x (1 + overhead) tokens.
    expect(fitPublic(many.slice(-11), 3 * (1 + PUBLIC_MESSAGE_OVERHEAD), 40).messages).toHaveLength(3);
  });

  it("drops empty or whitespace-only turns without counting them as trimmed, keeping roles alternating", () => {
    const msgs = [u("Vault pricing"), a(""), u("What about Relay?"), a("Relay is $49"), u(" \n\t "), a("stray"), u("and Pulse?")];
    expect(fitPublic(msgs, 20_000, 40)).toEqual({ messages: [u("What about Relay?"), a("Relay is $49"), u("and Pulse?")], dropped: 0 });
  });
});
