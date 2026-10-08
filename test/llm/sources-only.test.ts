import { expect, it } from "vitest";
import { sourcesOnlyEvents } from "../../src/llm/sources-only";
import { NOT_COVERED } from "../../src/llm/types";

it("streams a compact passage list and ends with a zero-cost done", () => {
  const evs = sourcesOnlyEvents("Vault pricing", []);
  const text = evs.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
  expect(text).toContain("[vault.md#pricing]");
  const done = evs.at(-1)!;
  expect(done).toMatchObject({ type: "done", answeredBy: "sources-only", costUsd: 0, invalidRefCount: 0, uncited: false });
  if (done.type === "done") {
    expect(done.passages[0].id).toBe("vault.md#pricing");
    expect(done.notices.some((n) => /not a checked answer/.test(n.text))).toBe(true);
  }
  expect(evs.filter((e) => e.type === "delta").length).toBeGreaterThan(1); // streamed in chunks
});

it("answers the exact not-covered line when nothing matches (E2)", () => {
  const evs = sourcesOnlyEvents("Does Relay support GraphQL?", []);
  expect(evs.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe(NOT_COVERED);
  expect(evs.at(-1)).toMatchObject({ type: "done", passages: [] });
});

it("always carries the sources-only notice, keeping notices passed in", () => {
  const passed = { kind: "fallback" as const, text: "X failed" };
  for (const q of ["Vault pricing", "Does Relay support GraphQL?"]) {
    const done = sourcesOnlyEvents(q, [passed]).at(-1)!;
    if (done.type !== "done") throw new Error("expected done");
    expect(done.notices).toContainEqual(passed);
    expect(done.notices.some((n) => /not a checked answer/.test(n.text))).toBe(true);
  }
});
