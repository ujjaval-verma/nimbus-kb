import raw from "./models.json";

export type ProviderId = "anthropic" | "openai" | "google";
export interface ModelConfig {
  id: string; provider: ProviderId; providerLabel: string; model: string; name: string;
  label: string; description: string; contextWindow: number; outputTokenLimit?: number;
  pricePerMTok: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  effort?: "low" | "medium" | "high";
  status: "implemented" | "placeholder";
}
export interface ModelsConfig {
  pricesCheckedOn: string; fallbackOrder: string[];
  contextWarning: { amber: number; red: number };
  models: ModelConfig[];
}

const PROVIDERS: ProviderId[] = ["anthropic", "openai", "google"];

export function validateConfig(input: unknown): ModelsConfig {
  const c = input as ModelsConfig;
  if (!c || !Array.isArray(c.models) || !Array.isArray(c.fallbackOrder)) throw new Error("models.json: missing models or fallbackOrder");
  const w = c.contextWarning;
  if (!w || !(w.amber > 0 && w.amber < w.red && w.red < 1)) throw new Error("models.json: contextWarning needs 0 < amber < red < 1");
  const ids = new Set<string>();
  for (const m of c.models) {
    if (ids.has(m.id)) throw new Error(`models.json: duplicate model id "${m.id}"`);
    ids.add(m.id);
    if (!PROVIDERS.includes(m.provider)) throw new Error(`models.json: unknown provider "${m.provider}"`);
    if (!(m.contextWindow > 0)) throw new Error(`models.json: contextWindow must be positive for "${m.id}"`);
    if (m.outputTokenLimit !== undefined && !(m.outputTokenLimit > 0)) throw new Error(`models.json: outputTokenLimit must be positive for "${m.id}"`);
    if (!(m.pricePerMTok?.input > 0 && m.pricePerMTok?.output > 0)) throw new Error(`models.json: price must be positive for "${m.id}"`);
    if (m.status !== "implemented" && m.status !== "placeholder") throw new Error(`models.json: bad status for "${m.id}"`);
    if (m.effort !== undefined && !["low", "medium", "high"].includes(m.effort)) throw new Error(`models.json: bad effort for "${m.id}"`);
  }
  for (const id of c.fallbackOrder) {
    const m = c.models.find((x) => x.id === id);
    if (!m || m.status !== "implemented") throw new Error(`models.json: fallbackOrder entry "${id}" is not an implemented model`);
  }
  return c;
}

export const CONFIG: ModelsConfig = validateConfig(raw);
export function getModel(id: string): ModelConfig | undefined { return CONFIG.models.find((m) => m.id === id); }
