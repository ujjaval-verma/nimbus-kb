import { expect, it, vi } from "vitest";
import { CONFIG } from "../../src/llm/config";
import { wrapperFromEnv } from "../../src/server/dev-fault";
import { fakeAdapter } from "../helpers/fake-adapter";

it("returns nothing for a missing or malformed spec", () => {
  const warn = vi.fn();
  expect(wrapperFromEnv(undefined, CONFIG, warn)).toBeUndefined();
  expect(wrapperFromEnv("claude-haiku:nonsense", CONFIG, warn)).toBeUndefined();
  expect(warn).not.toHaveBeenCalled();
});

it("wraps only the named model", async () => {
  const wrap = wrapperFromEnv("claude-haiku:rate_limit", CONFIG, vi.fn())!;
  const a = fakeAdapter({ chunks: ["ok"] });
  expect(wrap("claude-sonnet", a)).toBe(a);
  const it2 = wrap("claude-haiku", a).stream({} as never)[Symbol.asyncIterator]();
  await expect(it2.next()).rejects.toMatchObject({ kind: "rate_limit" });
});

it("warns when the spec parses but the model id is not in the config", () => {
  const warn = vi.fn();
  wrapperFromEnv("no-such-model:quota", CONFIG, warn);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toMatch(/no-such-model.*no effect/);
});
