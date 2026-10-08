import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { CONFIG } from "../llm/config";
import type { AdapterRegistry } from "../llm/types";
import { createApp } from "./app";
import { wrapperFromEnv } from "./dev-fault";

if (existsSync(".env")) process.loadEnvFile(".env");

const registry: AdapterRegistry = {};   // Task 7 adds claude-sub, Task 10 claude-api, Task 11 gemini
const port = Number(process.env.PORT ?? 8787);
const app = createApp({
  registry,
  wrapAdapter: wrapperFromEnv(process.env.FAULT_INJECT, CONFIG),
  allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],   // the Vite proxy (changeOrigin) sends 127.0.0.1:8787
});
// Loopback only: this server can spend the developer's Claude subscription, so nothing else on the network may reach it.
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`nimbus-kb api listening on http://127.0.0.1:${port}`);
