import type { ModelConfig } from "./config";
import type { Usage } from "./types";

export function costUsd(model: ModelConfig, u: Usage): number {
  const p = model.pricePerMTok;
  return (u.input * p.input + u.output * p.output + u.cacheRead * (p.cacheRead ?? p.input) + u.cacheWrite * (p.cacheWrite ?? p.input)) / 1e6;
}
