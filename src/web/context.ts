import { estimateTokens } from "../llm/context";
import type { ModelInfo } from "./api";
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

// The model whose window the meter reads: the one that would actually answer (a placeholder or unconfigured pick
// falls through to the first available model in the fallback order). If nothing matches, read the smallest
// implemented window, so the meter never depends on the order of models.json.
export function meterModel(models: ModelInfo[], selectedId: string, fallbackOrder: string[]): ModelInfo {
  const ids = [selectedId, ...fallbackOrder];
  const found = ids.map((id) => models.find((m) => m.id === id)).find((m) => m?.available);
  const smallest = models.filter((m) => m.status === "implemented").sort((a, b) => a.contextWindow - b.contextWindow)[0];
  return found ?? models.find((m) => m.id === selectedId) ?? smallest ?? models[0];
}

// On the public site history is capped well below the model's window; the meter measures against the smaller one.
export function effectiveWindow(contextWindow: number, contextCap: number | null): number {
  return contextCap === null ? contextWindow : Math.min(contextWindow, contextCap);
}
