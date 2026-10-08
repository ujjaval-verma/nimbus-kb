import { expect, it } from "vitest";
import { parseSSE } from "../../src/web/sse";

it("parses complete events and carries partial ones across chunks", () => {
  const a = parseSSE('event: attempt\ndata: {"type":"attempt","modelId":"m"}\n\nevent: delta\ndata: {"type":"del', "");
  expect(a.events).toEqual([{ type: "attempt", modelId: "m" }]);
  const b = parseSSE('ta","text":"hi"}\n\n', a.carry);
  expect(b.events).toEqual([{ type: "delta", text: "hi" }]);
  expect(b.carry).toBe("");
});
