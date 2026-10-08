import { expect, it } from "vitest";
import { applyEvent, historyFor, totals, type Turn } from "../../src/web/session";

const t0: Turn = { id: "1", question: "q", answer: "", status: "streaming", failed: [] };
const done = { type: "done" as const, answeredBy: "claude-sonnet", usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2 },
  costUsd: 0.01, passages: [], invalidRefCount: 0, uncited: false, contextTokens: 5000, notices: [] };

it("reset discards partial text and records the failed model (Review Focus 2)", () => {
  let t = applyEvent(t0, { type: "attempt", modelId: "claude-haiku" });
  t = applyEvent(t, { type: "delta", text: "PARTIAL" });
  t = applyEvent(t, { type: "reset", failedModelId: "claude-haiku", kind: "unavailable" });
  t = applyEvent(t, { type: "attempt", modelId: "claude-sonnet" });
  t = applyEvent(t, { type: "delta", text: "clean" });
  t = applyEvent(t, done);
  expect(t).toMatchObject({ answer: "clean", status: "done", failed: ["claude-haiku"] });
});

it("totals count cache tokens as input", () => {
  const t = applyEvent(t0, done);
  expect(totals([t, t])).toEqual({ input: 30, output: 10, costUsd: 0.02 });
});

it("history includes finished turns only, then the new question", () => {
  const finished = { ...applyEvent({ ...t0, answer: "a" }, done) };
  const errored: Turn = { ...t0, id: "2", status: "error", error: "x" };
  expect(historyFor([finished, errored], "next")).toEqual([
    { role: "user", content: "q" }, { role: "assistant", content: "a" }, { role: "user", content: "next" }]);
});
