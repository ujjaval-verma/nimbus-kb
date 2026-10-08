import { createClaudeApiAdapter } from "../llm/claude-api";
import type { AdapterRegistry } from "../llm/types";
import { createApp } from "./app";

export default {
  fetch(request, env, ctx) {
    const keys = env as { ANTHROPIC_API_KEY?: string };   // Task 13 registers adapters only behind the public quota
    const registry: AdapterRegistry = {};
    if (keys.ANTHROPIC_API_KEY) registry.anthropic = createClaudeApiAdapter({ apiKey: keys.ANTHROPIC_API_KEY });
    return createApp({ registry }).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
