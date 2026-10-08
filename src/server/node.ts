import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app";

if (existsSync(".env")) process.loadEnvFile(".env");

const port = Number(process.env.PORT ?? 8787);
// Loopback only: this server can spend the developer's Claude subscription, so nothing else on the network may reach it.
serve({ fetch: createApp({}).fetch, port, hostname: "127.0.0.1" });
console.log(`nimbus-kb api listening on http://127.0.0.1:${port}`);
