import { type Adapter, type AdapterChunk, type ErrorKind, ProviderError } from "./types";

export type FaultKind = ErrorKind | "midstream";
const KINDS: FaultKind[] = ["rate_limit", "quota", "auth", "unavailable", "bad_request", "midstream"];

export function parseFaultInject(spec: string | undefined): { modelId: string; kind: FaultKind } | null {
  const parts = (spec ?? "").split(":").map((x) => x.trim());
  if (parts.length !== 2) return null;
  const [modelId, kind] = parts;
  return modelId && KINDS.includes(kind as FaultKind) ? { modelId, kind: kind as FaultKind } : null;
}

export function withFault(adapter: Adapter, kind: FaultKind): Adapter {
  return {
    ...adapter,
    async *stream(): AsyncIterable<AdapterChunk> {
      if (kind === "midstream") {
        yield { type: "delta", text: "This partial text must never be shown. " };
        throw new ProviderError("unavailable", "injected mid-stream failure");
      }
      throw new ProviderError(kind, `injected ${kind}`);
    },
  };
}
