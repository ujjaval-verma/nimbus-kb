import { expect, it } from "vitest";
import { parseFaultInject, withFault } from "../../src/llm/fault";
import { ProviderError } from "../../src/llm/types";
import { fakeAdapter } from "../helpers/fake-adapter";

it("parses specs", () => {
  expect(parseFaultInject("claude-haiku:rate_limit")).toEqual({ modelId: "claude-haiku", kind: "rate_limit" });
  expect(parseFaultInject("claude-haiku:midstream")).toEqual({ modelId: "claude-haiku", kind: "midstream" });
  expect(parseFaultInject("")).toBeNull();
  expect(parseFaultInject("claude-haiku:nonsense")).toBeNull();
});

it("midstream yields a partial delta then throws unavailable", async () => {
  const it2 = withFault(fakeAdapter({ chunks: ["a"] }), "midstream").stream({} as never)[Symbol.asyncIterator]();
  expect((await it2.next()).value).toMatchObject({ type: "delta" });
  await expect(it2.next()).rejects.toMatchObject({ kind: "unavailable" });
});

it("other kinds throw immediately", async () => {
  const it2 = withFault(fakeAdapter({}), "quota").stream({} as never)[Symbol.asyncIterator]();
  await expect(it2.next()).rejects.toBeInstanceOf(ProviderError);
});
