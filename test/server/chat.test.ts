import { describe, expect, it, vi } from "vitest";
import { CONFIG, getModel } from "../../src/llm/config";
import { CHARS_PER_TOKEN } from "../../src/llm/context";
import { createApp, LIMITS } from "../../src/server/app";
import type { ChatEvent } from "../../src/llm/types";
import { fakeAdapter } from "../helpers/fake-adapter";
import { readEvents } from "../helpers/sse";

const post = (app: ReturnType<typeof createApp>, body: unknown) =>
  app.request("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/chat", () => {
  it.each(["", "   ", "\n\t  \n"])("rejects blank input %j without calling a provider (E10, Review Focus 5)", async (content) => {
    const adapter = fakeAdapter({ chunks: ["x"] });
    const res = await post(createApp({ registry: { anthropic: adapter } }), { modelId: "claude-haiku", messages: [{ role: "user", content }] });
    expect(res.status).toBe(400);
    expect(adapter.calls).toBe(0);
  });

  it("rejects malformed bodies, unknown models, and a last message not from the user", async () => {
    const app = createApp({});
    expect((await post(app, { nope: 1 })).status).toBe(400);
    expect((await post(app, { modelId: "x", messages: [{ role: "user", content: "hi" }] })).status).toBe(400);
    expect((await post(app, { modelId: "claude-haiku", messages: [{ role: "assistant", content: "hi" }] })).status).toBe(400);
  });

  it("rejects an over-long question but never over-long history (Review Focus 1)", async () => {
    const adapter = fakeAdapter({ chunks: ["ok"] });
    const app = createApp({ registry: { anthropic: adapter } });
    expect((await post(app, { modelId: "claude-haiku", messages: [{ role: "user", content: "x".repeat(2001) }] })).status).toBe(400);
    const res = await post(app, { modelId: "claude-haiku", messages: [
      { role: "user", content: "Compare all products" }, { role: "assistant", content: "y".repeat(30_000) },
      { role: "user", content: "what about its SLA?" }] });
    expect(res.status).toBe(200);
    const done = (await readEvents(res)).at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done).toMatchObject({ type: "done", answeredBy: "claude-haiku" });
    expect(done.notices).toEqual([]);              // 30k chars fits easily: nothing trimmed, nothing announced
    expect(adapter.lastReq!.messages).toHaveLength(3);
  });

  it("only accepts JSON bodies (blocks simple cross-site form posts)", async () => {
    const res = await createApp({}).request("/api/chat", { method: "POST", headers: { "content-type": "text/plain" },
      body: JSON.stringify({ modelId: "claude-haiku", messages: [{ role: "user", content: "hi" }] }) });
    expect(res.status).toBe(415);
  });

  it("rejects bodies over the size cap with 413, and the cap holds the largest window's worth of text", async () => {
    const res = await post(createApp({}), { modelId: "claude-haiku", messages: [{ role: "user", content: "x".repeat(LIMITS.maxBodyBytes) }] });
    expect(res.status).toBe(413);
    const largest = Math.max(...CONFIG.models.map((m) => m.contextWindow));   // every listed model, placeholders included
    expect(LIMITS.maxBodyBytes).toBeGreaterThan(2 * CHARS_PER_TOKEN * largest);   // fitting, not the body cap, is what limits history
  });

  it("never echoes provider error details in the stream", async () => {
    const adapter = fakeAdapter({ failWith: "auth", failMessage: "401 invalid x-api-key sk-ant-api03-SECRET" });
    const res = await post(createApp({ registry: { anthropic: adapter } }), { modelId: "claude-haiku", messages: [{ role: "user", content: "Vault pricing" }] });
    expect(await res.text()).not.toMatch(/sk-ant|x-api-key|SECRET/);
  });

  it("streams attempt, deltas and done", async () => {
    const res = await post(createApp({ registry: { anthropic: fakeAdapter({ chunks: ["Vault Pro is $35 ", "[vault.md#pricing]"] }) } }),
      { modelId: "claude-haiku", messages: [{ role: "user", content: "Vault Pro price?" }] });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const evs = await readEvents(res);
    expect(evs.map((e) => e.type)).toEqual(["attempt", "delta", "delta", "done"]);
  });

  it("a placeholder selection is skipped with a notice and the next implemented model answers (Review Focus 3)", async () => {
    const evs = await readEvents(await post(createApp({ registry: { anthropic: fakeAdapter({ chunks: ["ok"] }) } }),
      { modelId: "openai", messages: [{ role: "user", content: "Vault pricing" }] }));
    const done = evs.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.answeredBy).toBe("claude-sonnet");   // fallbackOrder[0]
    expect(done.notices[0].text).toMatch(/placeholder/);
  });

  it("an unconfigured backup model adds a notice only when no model can answer", async () => {
    // A second implemented provider with no adapter registered (e.g. local dev without GEMINI_API_KEY).
    const config = { ...CONFIG, fallbackOrder: ["claude-sonnet", "openai", "claude-haiku"],
      models: CONFIG.models.map((m) => (m.id === "openai" ? { ...m, status: "implemented" as const } : m)) };
    const ask = async (app: ReturnType<typeof createApp>) =>
      (await readEvents(await post(app, { modelId: "claude-haiku", messages: [{ role: "user", content: "Vault pricing" }] }))).at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect((await ask(createApp({ config, registry: { anthropic: fakeAdapter({ chunks: ["ok"] }) } }))).notices).toEqual([]);
    const none = await ask(createApp({ config }));
    expect(none.notices.map((n) => n.text).join(" ")).toContain(`${getModel("openai")!.name} isn't configured on this deployment`);
  });

  it("with no adapters (a keyless deployment) every request ends in sources-only", async () => {
    const evs = await readEvents(await post(createApp({}), { modelId: "claude-haiku", messages: [{ role: "user", content: "Vault pricing" }] }));
    const done = evs.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.answeredBy).toBe("sources-only");
    expect(done.notices.map((n) => n.text).join(" ")).toMatch(/isn't configured on this deployment/);
  });

  it("selected model goes first, then fallbackOrder", async () => {
    const evs = await readEvents(await post(createApp({ registry: { anthropic: fakeAdapter({ chunks: ["ok"] }) } }),
      { modelId: "claude-haiku", messages: [{ role: "user", content: "hi there" }] }));
    expect(evs[0]).toEqual({ type: "attempt", modelId: "claude-haiku" });
  });

  it("applies wrapAdapter (fault injection) per model id", async () => {
    const app = createApp({ registry: { anthropic: fakeAdapter({ chunks: ["ok"] }) },
      wrapAdapter: (id, a) => (id === "claude-haiku" ? fakeAdapter({ failWith: "rate_limit" }) : a) });
    const evs = await readEvents(await post(app, { modelId: "claude-haiku", messages: [{ role: "user", content: "Vault pricing" }] }));
    expect(evs.at(-1)).toMatchObject({ answeredBy: "claude-sonnet" });
  });
  it("rejects malformed message items and empty arrays (ruling a)", async () => {
    const app = createApp({});
    const bad: unknown[] = [
      { modelId: "claude-haiku", messages: [] },
      { modelId: "claude-haiku", messages: "hi" },
      { modelId: "claude-haiku", messages: [{ role: "system", content: "hi" }, { role: "user", content: "q" }] },
      { modelId: "claude-haiku", messages: [{ role: "user", content: 5 }] },
      { modelId: "claude-haiku", messages: [null, { role: "user", content: "q" }] },
      { modelId: "claude-haiku", messages: [{ role: "user", content: "x".repeat(LIMITS.maxMessageChars + 1) }, { role: "user", content: "q" }] },
    ];
    for (const b of bad) {
      const res = await post(app, b);
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty("error");
    }
    const res = await app.request("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(res.status).toBe(400);
  });

  it("returns 415 for text/plain before parsing or calling anything (ruling b)", async () => {
    const adapter = fakeAdapter({ chunks: ["x"] });
    const res = await createApp({ registry: { anthropic: adapter } }).request("/api/chat", { method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ modelId: "claude-haiku", messages: [{ role: "user", content: "Vault pricing" }] }) });
    expect(res.status).toBe(415);
    expect(adapter.calls).toBe(0);
  });

  it("aborts the provider call when the client disconnects", async () => {
    let seen: AbortSignal | undefined;
    let started!: () => void;
    const gotFirst = new Promise<void>((r) => { started = r; });
    const adapter = { name: "fake", tested: true,
      async *stream(req: { signal: AbortSignal }) { seen = req.signal; yield { type: "delta" as const, text: "a" }; started(); await new Promise(() => {}); } };
    const ac = new AbortController();
    const res = await createApp({ registry: { anthropic: adapter } }).request("/api/chat", { method: "POST", signal: ac.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelId: "claude-haiku", messages: [{ role: "user", content: "Vault pricing" }] }) });
    const reader = res.body!.getReader();
    await reader.read();
    await gotFirst;
    ac.abort();
    await reader.cancel().catch(() => {});
    await vi.waitFor(() => expect(seen!.aborted).toBe(true));
  });
});
