import { expect, it } from "vitest";
import { getModel } from "../../src/llm/config";
import { costUsd } from "../../src/llm/cost";

it("prices input, output and cache tokens at list prices", () => {
  const haiku = getModel("claude-haiku")!;
  // 1M input @ $1 + 100k output @ $5 + 1M cache read @ $0.10 + 100k cache write @ $1.25
  expect(costUsd(haiku, { input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite: 100_000 }))
    .toBeCloseTo(1 + 0.5 + 0.1 + 0.125, 10);
});

it("falls back to the input price when cache prices are absent", () => {
  const m = { ...getModel("claude-haiku")!, pricePerMTok: { input: 2, output: 4 } };
  expect(costUsd(m, { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 })).toBeCloseTo(4, 10);
});
