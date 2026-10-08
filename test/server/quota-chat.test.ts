import { describe, expect, it } from "vitest";
import { publicContextWindow } from "../../src/llm/context";
import { type Adapter, type ChatEvent, type ErrorKind, ProviderError } from "../../src/llm/types";
import { createApp } from "../../src/server/app";
import { createQuotaGate, MemoryQuotaStore, PUBLIC_HISTORY_TOKENS, PUBLIC_MAX_MESSAGES, PUBLIC_MAX_OUTPUT_TOKENS, QUOTA_LIMITS, QuotaLedger } from "../../src/server/quota";
import { fakeAdapter } from "../helpers/fake-adapter";
import { readEvents } from "../helpers/sse";

type Done = Extract<ChatEvent, { type: "done" }>;
type Msg = { role: "user" | "assistant"; content: string };
const IP = "203.0.113.7";
const N = QUOTA_LIMITS.perVisitor;   // 10 by default
const quota = (o: { perVisitor?: number; siteWide?: number; burstOk?: boolean } = {}) => {
  const limits = { perVisitor: o.perVisitor ?? N, siteWide: o.siteWide ?? QUOTA_LIMITS.siteWide };
  return createQuotaGate({ ledger: new QuotaLedger(new MemoryQuotaStore(), limits), limits,
    burst: { limit: async () => ({ success: o.burstOk ?? true }) }, salt: "test-salt" });
};
const ask = (app: ReturnType<typeof createApp>, o: { ip?: string | null; content?: string; messages?: Msg[] } = {}) => {
  const ip = o.ip === undefined ? IP : o.ip;
  return app.request("/api/chat", { method: "POST",
    headers: { "content-type": "application/json", ...(ip ? { "cf-connecting-ip": ip } : {}) },
    body: JSON.stringify({ modelId: "claude-sonnet", messages: o.messages ?? [{ role: "user", content: o.content ?? "Vault pricing" }] }) });
};
const done = async (res: Response) => (await readEvents(res)).at(-1) as Done;
const longHistory: Msg[] = [{ role: "user", content: "Compare all products" }, { role: "assistant", content: "y".repeat(90_000) },
  { role: "user", content: "what about its SLA?" }];

describe("public quota on /api/chat (Review Focus 6)", () => {
  it("10 answers a day by default, then passages plus the run-it-yourself notice, with no model call", async () => {
    const adapter = fakeAdapter({ chunks: ["Pro is $35 [vault.md#pricing]"] });
    const app = createApp({ registry: { anthropic: adapter }, quota: quota() });
    for (let left = N - 1; left >= 0; left--) {
      expect(await done(await ask(app))).toMatchObject({ answeredBy: "claude-sonnet", quota: { limit: N, remaining: left } });
    }
    const over = await done(await ask(app));
    expect(over.answeredBy).toBe("sources-only");
    expect(over.notices[0]).toEqual({ kind: "quota_exhausted", text: "You've used today's 10 answers. Run it yourself for unlimited answers." });
    expect(over.quota).toEqual({ limit: N, remaining: 0 });
    expect(adapter.calls).toBe(N);
  });

  it("a deployer's configured limit reaches the notice and the quota field", async () => {
    const app = createApp({ registry: { anthropic: fakeAdapter({ chunks: ["ok"] }) }, quota: quota({ perVisitor: 3 }) });
    for (let i = 0; i < 3; i++) await ask(app);
    const over = await done(await ask(app));
    expect(over.notices[0].text).toBe("You've used today's 3 answers. Run it yourself for unlimited answers.");
    expect(over.quota).toEqual({ limit: 3, remaining: 0 });
  });

  it("the site-wide cap stops every visitor", async () => {
    const adapter = fakeAdapter({ chunks: ["ok"] });
    const app = createApp({ registry: { anthropic: adapter }, quota: quota({ siteWide: 2 }) });
    await ask(app, { ip: "198.51.100.1" });
    await ask(app, { ip: "198.51.100.2" });
    const third = await done(await ask(app, { ip: "198.51.100.3" }));
    expect(third.answeredBy).toBe("sources-only");
    expect(third.notices[0]).toMatchObject({ kind: "quota_exhausted", text: expect.stringMatching(/all of today's answers/) });
    expect(adapter.calls).toBe(2);
  });

  it("a question that falls back across providers uses one answer", async () => {
    const app = createApp({ registry: { anthropic: fakeAdapter({ failWith: "unavailable" }), google: fakeAdapter({ chunks: ["ok"] }) }, quota: quota() });
    const d = await done(await ask(app));
    expect(d.answeredBy).toBe("gemini-flash-lite");
    expect(d.quota).toEqual({ limit: N, remaining: N - 1 });
  });

  it("a question no model answered gives its answer back", async () => {
    const d = await done(await ask(createApp({ registry: { anthropic: fakeAdapter({ failWith: "unavailable" }) }, quota: quota() })));
    expect(d.answeredBy).toBe("sources-only");
    expect(d.quota).toEqual({ limit: N, remaining: N });
  });

  it("concurrent questions cannot get past the limit", async () => {
    const adapter = fakeAdapter({ chunks: ["ok"] });
    const app = createApp({ registry: { anthropic: adapter }, quota: quota() });
    const all = await Promise.all(Array.from({ length: N + 3 }, async () => done(await ask(app))));
    expect(all.filter((d) => d.answeredBy !== "sources-only")).toHaveLength(N);
    expect(adapter.calls).toBe(N);
  });

  it("fails closed without cf-connecting-ip: no model call and nothing counted", async () => {
    const adapter = fakeAdapter({ chunks: ["ok"] });
    const d = await done(await ask(createApp({ registry: { anthropic: adapter }, quota: quota() }), { ip: null }));
    expect(d.answeredBy).toBe("sources-only");
    expect(adapter.calls).toBe(0);
    expect(d.quota).toBeUndefined();
  });

  it("rejected requests never count", async () => {
    const g = quota();
    const app = createApp({ registry: { anthropic: fakeAdapter({ chunks: ["ok"] }) }, quota: g });
    expect((await ask(app, { content: "   " })).status).toBe(400);
    expect(await g.peek(IP)).toMatchObject({ remaining: N });
  });

  it("the burst limit answers 429 with a plain message and nothing internal in the headers", async () => {
    const adapter = fakeAdapter({ chunks: ["ok"] });
    const res = await ask(createApp({ registry: { anthropic: adapter }, quota: quota({ burstOk: false }) }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "You're sending questions quickly. Wait a few seconds and try again." });
    const headers: string[] = [];
    res.headers.forEach((v, k) => headers.push(`${k}: ${v}`));
    expect(headers.join("\n")).not.toMatch(/test-salt|[0-9a-f]{64}|203\.0\.113\.7/);
    expect(adapter.calls).toBe(0);
  });

  it("caps history and reply size, with the usual trim notice", async () => {
    const adapter = fakeAdapter({ chunks: ["ok [vault.md#pricing]"] });
    const d = await done(await ask(createApp({ registry: { anthropic: adapter }, quota: quota() }), { messages: longHistory }));
    expect(adapter.lastReq!.maxOutputTokens).toBe(PUBLIC_MAX_OUTPUT_TOKENS);
    expect(adapter.lastReq!.messages).toEqual([{ role: "user", content: "what about its SLA?" }]);
    expect(d.notices).toEqual([expect.objectContaining({ kind: "context", text: expect.stringMatching(/left out/) })]);
  });

  it("without a quota (local dev, tests) there are no caps and no quota fields", async () => {
    const adapter = fakeAdapter({ chunks: ["ok"] });
    const d = await done(await ask(createApp({ registry: { anthropic: adapter } }), { messages: longHistory }));
    expect(adapter.lastReq!.maxOutputTokens).toBeUndefined();
    expect(adapter.lastReq!.messages).toHaveLength(3);
    expect(d.quota).toBeUndefined();
  });
});

describe("public quota: hard history bound and reservation edge cases", () => {
  it("measures history in UTF-8 bytes: multi-byte text under the character estimate is still trimmed", async () => {
    const adapter = fakeAdapter({ chunks: ["ok [vault.md#pricing]"] });
    const cjk = "漢".repeat(25_000);   // 8,334 estimate tokens, 75,000 bytes
    const d = await done(await ask(createApp({ registry: { anthropic: adapter }, quota: quota() }),
      { messages: [{ role: "user", content: "Compare all products" }, { role: "assistant", content: cjk }, { role: "user", content: "what about its SLA?" }] }));
    expect(adapter.lastReq!.messages).toEqual([{ role: "user", content: "what about its SLA?" }]);
    expect(d.notices).toEqual([expect.objectContaining({ kind: "context", text: expect.stringMatching(/this public site allows/) })]);
    const local = fakeAdapter({ chunks: ["ok"] });   // no quota (Node, tests): unchanged, the whole history is sent
    await done(await ask(createApp({ registry: { anthropic: local } }), { messages: [{ role: "user", content: "a" }, { role: "assistant", content: cjk }, { role: "user", content: "b" }] }));
    expect(local.lastReq!.messages).toHaveLength(3);
  });

  it("caps the number of history messages, however small they are", async () => {
    const adapter = fakeAdapter({ chunks: ["ok"] });
    const many: Msg[] = Array.from({ length: 201 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: i % 2 === 0 ? "q" : "a" }));
    const d = await done(await ask(createApp({ registry: { anthropic: adapter }, quota: quota() }), { messages: many }));
    expect(adapter.lastReq!.messages.length).toBeLessThanOrEqual(PUBLIC_MAX_MESSAGES);
    expect(adapter.lastReq!.messages.length).toBeGreaterThanOrEqual(PUBLIC_MAX_MESSAGES - 1);
    expect(d.notices).toEqual([expect.objectContaining({ kind: "context" })]);
  });

  it("drops empty earlier turns instead of rejecting the request", async () => {
    const adapter = fakeAdapter({ chunks: ["ok"] });
    const res = await ask(createApp({ registry: { anthropic: adapter }, quota: quota() }), { messages: [
      { role: "user", content: "Vault pricing" }, { role: "assistant", content: "" },
      { role: "user", content: "What about Relay?" }, { role: "assistant", content: "Relay Pro is $49 [relay.md#pricing]" },
      { role: "user", content: "  \n " }, { role: "assistant", content: "stray" }, { role: "user", content: "and Pulse?" }] });
    expect(res.status).toBe(200);
    const d = await done(res);
    expect(adapter.lastReq!.messages).toEqual([{ role: "user", content: "What about Relay?" },
      { role: "assistant", content: "Relay Pro is $49 [relay.md#pricing]" }, { role: "user", content: "and Pulse?" }]);
    expect(d.notices).toEqual([]);
  });

  it("a client that disconnects after the first text keeps its reservation (a model was called)", async () => {
    const g = quota();
    const hanging: Adapter = { name: "hang", tested: true, async *stream(req) {
      yield { type: "delta", text: "Pro is" };
      await new Promise((r) => req.signal.addEventListener("abort", r, { once: true }));
      throw new ProviderError("unavailable", "aborted");
    } };
    const res = await ask(createApp({ registry: { anthropic: hanging }, quota: g }));
    const reader = res.body!.getReader();
    let seen = "";
    while (!seen.includes("event: delta")) seen += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(await g.peek(IP)).toMatchObject({ remaining: N - 1 });
  });

  it("an unexpected error before any text gives the answer back; after text it does not (the model was billed)", async () => {
    const bogus = "not-a-kind" as ErrorKind;   // makes runChain itself throw, past its own error handling
    const g1 = quota();
    const before = await readEvents(await ask(createApp({ registry: { anthropic: fakeAdapter({ failWith: bogus }) }, quota: g1 })));
    expect(before.at(-1)).toMatchObject({ type: "error" });
    expect(await g1.peek(IP)).toMatchObject({ remaining: N });
    const g2 = quota();
    const after = await readEvents(await ask(createApp({ registry: { anthropic: fakeAdapter({ chunks: ["partial"], failWith: bogus }) }, quota: g2 })));
    expect(after.map((e) => e.type)).toContain("delta");
    expect(after.at(-1)).toMatchObject({ type: "error" });
    expect(await g2.peek(IP)).toMatchObject({ remaining: N - 1 });
  });

  it("a failing burst limiter answers 503 in plain language and calls no model", async () => {
    const adapter = fakeAdapter({ chunks: ["ok"] });
    const g = { ...quota(), allowBurst: async () => { throw new Error("limiter down"); } };
    const res = await ask(createApp({ registry: { anthropic: adapter }, quota: g }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "The service is busy right now. Try again in a moment." });
    expect(adapter.calls).toBe(0);
  });
});

describe("public quota on /api/models", () => {
  it("reports what is left and the capped window the meter must use", async () => {
    const app = createApp({ registry: { anthropic: fakeAdapter({}) }, quota: quota() });
    const body = await (await app.request("/api/models", { headers: { "cf-connecting-ip": IP } })).json() as
      { quota: { limit: number; remaining: number } | null; contextCap: number | null; systemPromptTokens: number };
    expect(body.quota).toEqual({ limit: N, remaining: N });
    expect(body.contextCap).toBe(publicContextWindow(body.systemPromptTokens, PUBLIC_HISTORY_TOKENS));
    // Trimming starts at system + 20,000: past red (90%) and at no more than the usual 95% of the meter's window.
    const trimAt = (body.systemPromptTokens + PUBLIC_HISTORY_TOKENS) / body.contextCap!;
    expect(trimAt).toBeGreaterThan(0.9);
    expect(trimAt).toBeLessThanOrEqual(0.95 + 1e-9);
  });

  it("reports no quota and no cap without one, and no quota without a visitor address", async () => {
    expect(await (await createApp({}).request("/api/models")).json()).toMatchObject({ quota: null, contextCap: null });
    const app = createApp({ registry: { anthropic: fakeAdapter({}) }, quota: quota() });
    expect(await (await app.request("/api/models")).json()).toMatchObject({ quota: null });
  });

  it("reports no quota when no model is available (salt set, no keys), so no pill promises answers", async () => {
    const app = createApp({ quota: quota() });
    expect(await (await app.request("/api/models", { headers: { "cf-connecting-ip": IP } })).json()).toMatchObject({ quota: null });
    expect((await done(await ask(app))).quota).toBeUndefined();
  });

  it("a failing counter never breaks the page, and chat fails closed", async () => {
    const broken = { ...quota(), peek: async () => { throw new Error("DO down"); }, reserve: async () => { throw new Error("DO down"); } };
    const adapter = fakeAdapter({ chunks: ["ok"] });
    const app = createApp({ registry: { anthropic: adapter }, quota: broken });
    const res = await app.request("/api/models", { headers: { "cf-connecting-ip": IP } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ quota: null });
    const d = await done(await ask(app));
    expect(d.answeredBy).toBe("sources-only");
    expect(d.notices[0].text).toMatch(/paused/);
    expect(adapter.calls).toBe(0);
  });
});
