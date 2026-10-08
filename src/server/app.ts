import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { SECTIONS } from "../kb";
import { CONFIG, type ModelConfig, type ModelsConfig } from "../llm/config";
import { estimateTokens } from "../llm/context";
import { type ChainLink, runChain } from "../llm/fallback";
import { skippedNotice } from "../llm/notices";
import { buildSystemPrompt } from "../llm/prompt";
import { SECURITY_HEADERS } from "./security";
import type { Adapter, AdapterRegistry, ChatMessage, Notice } from "../llm/types";

export interface AppDeps {
  registry?: AdapterRegistry; config?: ModelsConfig;
  wrapAdapter?: (modelId: string, adapter: Adapter) => Adapter;
  firstTokenTimeoutMs?: number;
  allowedHosts?: string[];   // Node entry only: blocks DNS rebinding against the local server
}
// No cap on the number of turns: runChain fits history to each model's window and announces any trimming.
// The body cap only stops abuse; it is sized above the largest window's worth of text (a test checks this).
export const LIMITS = { maxQuestionChars: 2000, maxMessageChars: 200_000, maxBodyBytes: 8_000_000 } as const;
const SYSTEM = buildSystemPrompt(SECTIONS);
const SYSTEM_TOKENS = estimateTokens(SYSTEM);

function parseBody(body: unknown, config: ModelsConfig): { model: ModelConfig; messages: ChatMessage[] } | string {
  const b = body as { modelId?: unknown; messages?: unknown };
  if (!b || typeof b.modelId !== "string" || !Array.isArray(b.messages) || b.messages.length === 0) return "Malformed request.";
  const model = config.models.find((m) => m.id === b.modelId);
  if (!model) return "Unknown model.";
  const messages: ChatMessage[] = [];
  for (const m of b.messages as { role?: unknown; content?: unknown }[]) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return "Malformed message.";
    if (m.content.length > LIMITS.maxMessageChars) return "A message in this conversation is too long.";
    messages.push({ role: m.role, content: m.content });
  }
  const last = messages[messages.length - 1];
  if (last.role !== "user") return "The last message must be from the user.";
  if (last.content.trim() === "") return "Please type a question.";
  if (last.content.length > LIMITS.maxQuestionChars) return `Please keep questions under ${LIMITS.maxQuestionChars} characters.`;
  return { model, messages };
}

export function createApp(deps: AppDeps = {}): Hono {
  const registry = deps.registry ?? {};
  const config = deps.config ?? CONFIG;
  const adapterFor = (m: ModelConfig) => (m.status === "implemented" ? registry[m.provider] : undefined);
  const app = new Hono();

  app.use("*", async (c, next) => {
    // A page on another site can rebind its hostname to 127.0.0.1 and call the local server "same-origin".
    // The Host header still carries the attacker's hostname, so the Node entry only accepts its own.
    // (@hono/node-server builds the request URL from the Host header; fetch Requests hide `host` from headers.)
    if (deps.allowedHosts && !deps.allowedHosts.includes(new URL(c.req.url).host)) return c.text("Forbidden", 403);
    await next();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/models", (c) => c.json({
    fallbackOrder: config.fallbackOrder,
    contextWarning: config.contextWarning,
    systemPromptTokens: SYSTEM_TOKENS,
    models: config.models.map((m) => {
      const a = adapterFor(m);
      return { ...m, available: !!a, tested: !!a?.tested };
    }),
  }));

  app.post("/api/chat", bodyLimit({
    maxSize: LIMITS.maxBodyBytes,
    onError: (c) => c.json({ error: "This conversation is too large to send. Start a new chat." }, 413),
  }), async (c) => {
    if (!(c.req.header("content-type") ?? "").startsWith("application/json")) return c.json({ error: "Expected JSON." }, 415);
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: "Malformed request." }, 400); }
    const parsed = parseBody(body, config);
    if (typeof parsed === "string") return c.json({ error: parsed }, 400);

    const order = [parsed.model.id, ...config.fallbackOrder.filter((id) => id !== parsed.model.id)];
    const links: ChainLink[] = [];
    const skipped: Notice[] = [];
    const unconfigured: Notice[] = [];
    for (const id of order) {
      const model = config.models.find((m) => m.id === id)!;
      const adapter = adapterFor(model);
      if (adapter) links.push({ model, adapter: deps.wrapAdapter ? deps.wrapAdapter(id, adapter) : adapter });
      else if (id === parsed.model.id) skipped.push(skippedNotice(model));
      else if (model.status === "implemented") unconfigured.push(skippedNotice(model));
    }
    // Unconfigured backups only explain anything when no model can answer (a keyless deployment); otherwise they are noise on every reply.
    if (links.length === 0) skipped.push(...unconfigured);

    const messages = parsed.messages;          // fitted per model inside runChain
    const query = messages[messages.length - 1].content;
    const ac = new AbortController();
    return streamSSE(c, async (stream) => {
      stream.onAbort(() => ac.abort());
      try {
        for await (const ev of runChain({ links, skipped, system: SYSTEM, messages, query, signal: ac.signal,
          firstTokenTimeoutMs: deps.firstTokenTimeoutMs })) {
          if (stream.aborted || ac.signal.aborted) break;   // client gone: stop iterating so runChain cancels the provider call
          await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
        }
      } catch (err) {
        if (stream.aborted) return;
        console.error("[chat] unexpected", err);
        await stream.writeSSE({ event: "error", data: JSON.stringify({ type: "error", message: "Something went wrong on our side. Please try again." }) });
      }
    });
  });

  return app;
}
