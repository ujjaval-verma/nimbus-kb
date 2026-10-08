import { Hono } from "hono";

// Grows in Task 6.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface AppDeps {}

export function createApp(_deps: AppDeps): Hono {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ ok: true }));
  return app;
}
