import { createClaudeApiAdapter } from "../llm/claude-api";
import { createGeminiAdapter } from "../llm/gemini";
import type { AdapterRegistry } from "../llm/types";
import { createApp } from "./app";
import { createQuotaGate, type Ledger, parseQuotaLimits, type QuotaGate, type QuotaVars } from "./quota";
import { checkSiteGate } from "./site-gate";

export { QuotaCounter } from "./quota-do";

interface Secrets { ANTHROPIC_API_KEY?: string; GEMINI_API_KEY?: string; QUOTA_SALT?: string; SITE_PASSWORD?: string }

function quotaFor(env: Env, salt: string | undefined): QuotaGate | undefined {
  if (!env.QUOTA || !env.BURST || !salt) return undefined;
  const parsed = parseQuotaLimits(env as unknown as QuotaVars);
  if (!parsed.ok) {   // fail closed: never unlimited
    console.error(`[quota] ${parsed.error}; serving sources-only until wrangler.json vars are fixed`);
    return undefined;
  }
  const stub = env.QUOTA.get(env.QUOTA.idFromName("quota"));   // one global counter
  const ledger: Ledger = { peek: (v, d) => stub.peek(v, d), reserve: (v, d) => stub.reserve(v, d), release: (v, d) => stub.release(v, d) };
  return createQuotaGate({ ledger, burst: env.BURST, salt, limits: parsed.limits });
}

export default {
  async fetch(request, env, ctx) {
    const secrets = env as unknown as Secrets;   // Worker secrets (wrangler secret put); never in the bundle
    // Every path (page, assets, API) sits behind the shared password when SITE_PASSWORD is set; unset means open.
    const denied = await checkSiteGate(request, secrets.SITE_PASSWORD);
    if (denied) return denied;
    if (!new URL(request.url).pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const quota = quotaFor(env, secrets.QUOTA_SALT);
    const registry: AdapterRegistry = {};
    // Keys are spent only behind the quota: without the counter, the burst limiter and the salt, no model is registered.
    if (quota) {
      if (secrets.ANTHROPIC_API_KEY) registry.anthropic = createClaudeApiAdapter({ apiKey: secrets.ANTHROPIC_API_KEY });
      if (secrets.GEMINI_API_KEY) registry.google = createGeminiAdapter({ apiKey: secrets.GEMINI_API_KEY });
    } else if (secrets.ANTHROPIC_API_KEY || secrets.GEMINI_API_KEY) {
      console.error("[quota] provider keys are set but the quota is not (QUOTA, BURST, QUOTA_SALT, valid limits); serving sources-only");
    }
    return createApp({ registry, quota }).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
