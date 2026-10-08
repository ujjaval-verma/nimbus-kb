import { estimateTokens } from "../llm/context";
import type { Turn } from "./session";

export type ContextLevel = "ok" | "amber" | "red";

// What the next request would put in the window, in the same estimate units the server trims with
// (3 characters per token), so amber/red always come before trimming. The last model reply's contextTokens is the
// server's count after any trimming; turns after it, and everything before the first model reply, are estimated here.
export function contextUsage(o: { turns: Turn[]; contextWindow: number; systemPromptTokens: number;
  thresholds: { amber: number; red: number } }) {
  const done = o.turns.filter((t) => t.status === "done");
  const est = (ts: Turn[]) => ts.reduce((n, t) => n + estimateTokens(t.question) + estimateTokens(t.answer), 0);
  const lastIdx = done.findLastIndex((t) => !!t.done && t.done.answeredBy !== "sources-only");
  let tokens: number;
  if (lastIdx < 0) tokens = o.systemPromptTokens + est(done);
  else {
    tokens = done[lastIdx].done!.contextTokens + est(done.slice(lastIdx + 1));
  }
  const ratio = tokens / o.contextWindow;
  const level: ContextLevel = ratio >= o.thresholds.red ? "red" : ratio >= o.thresholds.amber ? "amber" : "ok";
  return { tokens, ratio, level };
}
