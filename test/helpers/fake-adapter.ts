import { type Adapter, type AdapterChunk, type AdapterRequest, type ErrorKind, ProviderError } from "../../src/llm/types";

export function fakeAdapter(script: { chunks?: string[]; failWith?: ErrorKind; failAfter?: number; failMessage?: string; hang?: boolean;
  usage?: { input: number; output: number } }): Adapter & { calls: number; lastReq?: AdapterRequest } {
  const a: Adapter & { calls: number; lastReq?: AdapterRequest } = {
    name: "fake", tested: true, calls: 0,
    async *stream(req: AdapterRequest): AsyncIterable<AdapterChunk> {
      a.calls++;
      a.lastReq = req;
      const msg = script.failMessage ?? "boom";
      if (script.hang) await new Promise(() => {});
      const chunks = script.chunks ?? [];
      for (let i = 0; i < chunks.length; i++) {
        if (script.failWith && script.failAfter === i) throw new ProviderError(script.failWith, msg);
        yield { type: "delta", text: chunks[i] };
      }
      if (script.failWith && (script.failAfter === undefined || script.failAfter >= chunks.length)) throw new ProviderError(script.failWith, msg);
      yield { type: "usage", usage: { input: script.usage?.input ?? 100, output: script.usage?.output ?? 10, cacheRead: 0, cacheWrite: 0 } };
    },
  };
  return a;
}
