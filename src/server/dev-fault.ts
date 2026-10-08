// Node entry only. Fault injection is never wired in worker.ts.
import type { ModelsConfig } from "../llm/config";
import { parseFaultInject, withFault } from "../llm/fault";
import type { Adapter } from "../llm/types";

export function wrapperFromEnv(spec: string | undefined, config: ModelsConfig, warn: (msg: string) => void = console.warn):
  ((modelId: string, adapter: Adapter) => Adapter) | undefined {
  const fault = parseFaultInject(spec);
  if (!fault) return undefined;
  if (!config.models.some((m) => m.id === fault.modelId)) {
    warn(`FAULT_INJECT names "${fault.modelId}", which is not in models.json; it will have no effect.`);
  } else {
    console.log(`FAULT_INJECT active: ${fault.modelId} -> ${fault.kind}`);
  }
  return (id, a) => (id === fault.modelId ? withFault(a, fault.kind) : a);
}
