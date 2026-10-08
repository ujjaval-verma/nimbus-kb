import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createClaudeApiAdapter } from "../llm/claude-api";
import { createClaudeSubAdapter } from "../llm/claude-sub";
import { createGeminiAdapter } from "../llm/gemini";
import { CONFIG } from "../llm/config";
import type { AdapterRegistry } from "../llm/types";
import { selectAnthropic } from "./anthropic-select";
import { createApp } from "./app";
import { wrapperFromEnv } from "./dev-fault";

if (existsSync(".env")) process.loadEnvFile(".env");

const registry: AdapterRegistry = {};
const choice = selectAnthropic(process.env);
if (choice === "api") registry.anthropic = createClaudeApiAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! });
else if (choice === "subscription") registry.anthropic = createClaudeSubAdapter();
console.log(`anthropic: ${choice === "api" ? "api (ANTHROPIC_DEV_API=1)" : choice}`);   // never the key
if (process.env.GEMINI_API_KEY) registry.google = createGeminiAdapter({ apiKey: process.env.GEMINI_API_KEY });
console.log(`gemini: ${registry.google ? "on" : "off"}`);   // never the key
const port = Number(process.env.PORT ?? 8787);
const app = createApp({
  registry,
  wrapAdapter: wrapperFromEnv(process.env.FAULT_INJECT, CONFIG),
  allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],   // the Vite proxy (changeOrigin) sends 127.0.0.1:8787
});
// Loopback only: this server can spend the developer's Claude subscription or, with ANTHROPIC_DEV_API=1, their paid API key, so nothing else on the network may reach it.
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`nimbus-kb api listening on http://127.0.0.1:${port}`);
