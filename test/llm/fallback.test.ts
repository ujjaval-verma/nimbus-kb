import { describe, expect, it } from "vitest";
import { getModel } from "../../src/llm/config";
import { estimateTokens } from "../../src/llm/context";
import { runChain } from "../../src/llm/fallback";
import { SOURCES_ONLY_NOTICE } from "../../src/llm/notices";
import type { Adapter, AdapterChunk, AdapterRequest, ChatEvent } from "../../src/llm/types";
import { fakeAdapter } from "../helpers/fake-adapter";

const haiku = getModel("claude-haiku")!;
const sonnet = getModel("claude-sonnet")!;
const run = async (links: Parameters<typeof runChain>[0]["links"], extra: Partial<Parameters<typeof runChain>[0]> = {}) => {
  const out: ChatEvent[] = [];
  for await (const e of runChain({ links, skipped: [], system: "sys", messages: [{ role: "user", content: "Vault pricing" }],
    query: "Vault pricing", signal: new AbortController().signal, ...extra })) out.push(e);
  return out;
};
const text = (evs: ChatEvent[]) => {
  let t = "";
  for (const e of evs) { if (e.type === "attempt") t = ""; if (e.type === "delta") t += e.text; if (e.type === "reset") t = ""; }
  return t;
};

describe("runChain", () => {
  it("answers with the first link, cites, and prices usage", async () => {
    const evs = await run([{ model: haiku, adapter: fakeAdapter({ chunks: ["Pro is $35 ", "[vault.md#pricing]."], usage: { input: 1_000_000, output: 0 } }) }]);
    expect(evs.map((e) => e.type)).toEqual(["attempt", "delta", "delta", "done"]);
    expect(evs.at(-1)).toMatchObject({ answeredBy: "claude-haiku", costUsd: 1, invalidRefCount: 0, uncited: false, notices: [] });
    const done = evs.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.passages.map((p) => p.id)).toEqual(["vault.md#pricing"]);
  });

  it.each(["rate_limit", "quota", "auth", "unavailable", "bad_request"] as const)("advances on %s with a notice", async (kind) => {
    const evs = await run([
      { model: haiku, adapter: fakeAdapter({ failWith: kind }) },
      { model: sonnet, adapter: fakeAdapter({ chunks: ["ok"] }) },
    ]);
    const done = evs.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.answeredBy).toBe("claude-sonnet");
    expect(done.notices[0].text).toContain("Claude Haiku 4.5");
    expect(evs.some((e) => e.type === "reset")).toBe(false);   // nothing streamed, nothing to reset
  });

  it("mid-stream failure emits reset and the final text has no partial output (E8, Review Focus 2)", async () => {
    const evs = await run([
      { model: haiku, adapter: fakeAdapter({ chunks: ["PARTIAL ", "more"], failWith: "unavailable", failAfter: 1 }) },
      { model: sonnet, adapter: fakeAdapter({ chunks: ["clean answer"] }) },
    ]);
    expect(evs.map((e) => e.type)).toEqual(["attempt", "delta", "reset", "attempt", "delta", "done"]);
    expect(evs[2]).toEqual({ type: "reset", failedModelId: "claude-haiku", kind: "unavailable" });
    expect(text(evs)).toBe("clean answer");
  });

  it("ends in sources-only when every link fails", async () => {
    const evs = await run([{ model: haiku, adapter: fakeAdapter({ failWith: "auth" }) }]);
    expect(evs.at(-1)).toMatchObject({ type: "done", answeredBy: "sources-only" });
  });

  it("ends in sources-only with skipped notices when there are no links", async () => {
    const evs = await run([], { skipped: [{ kind: "unavailable", text: "GPT-6 Luna is a placeholder" }] });
    const done = evs.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.answeredBy).toBe("sources-only");
    expect(done.notices[0].text).toBe("GPT-6 Luna is a placeholder");
  });

  it("treats no first token within the timeout as unavailable and cancels the hung call", async () => {
    const hung = fakeAdapter({ hang: true });
    const evs = await run([
      { model: haiku, adapter: hung },
      { model: sonnet, adapter: fakeAdapter({ chunks: ["ok"] }) },
    ], { firstTokenTimeoutMs: 20 });
    expect(evs.at(-1)).toMatchObject({ answeredBy: "claude-sonnet" });
    expect(hung.lastReq!.signal.aborted).toBe(true);
  });

  it("a stream that stalls after its first token times out as unavailable, resets, and moves on", async () => {
    let cancelled = false;
    const stalls: Adapter = {
      name: "s", tested: true,
      async *stream(req: AdapterRequest): AsyncIterable<AdapterChunk> {
        req.signal.addEventListener("abort", () => { cancelled = true; });
        yield { type: "delta", text: "partial " };
        await new Promise(() => {});
      },
    };
    const evs = await run([{ model: haiku, adapter: stalls }, { model: sonnet, adapter: fakeAdapter({ chunks: ["ok"] }) }], { idleTimeoutMs: 30, firstTokenTimeoutMs: 1000 });
    expect(evs.map((e) => e.type)).toContain("reset");
    expect(evs.find((e) => e.type === "reset")).toMatchObject({ failedModelId: "claude-haiku", kind: "unavailable" });
    expect(evs.at(-1)).toMatchObject({ type: "done", answeredBy: "claude-sonnet" });
    expect(cancelled).toBe(true);
  });

  it("a slow but steady stream is not cut off by the idle timeout", async () => {
    const steady: Adapter = {
      name: "s", tested: true,
      async *stream(): AsyncIterable<AdapterChunk> {
        for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 15)); yield { type: "delta", text: "x " }; }
        yield { type: "usage", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
      },
    };
    const evs = await run([{ model: haiku, adapter: steady }], { idleTimeoutMs: 60 });
    expect(evs.at(-1)).toMatchObject({ type: "done", answeredBy: "claude-haiku" });
    expect(evs.map((e) => e.type)).not.toContain("reset");
  });

  it("does not call later links when the first succeeds", async () => {
    const second = fakeAdapter({ chunks: ["x"] });
    await run([{ model: haiku, adapter: fakeAdapter({ chunks: ["a"] }) }, { model: sonnet, adapter: second }]);
    expect(second.calls).toBe(0);
  });

  it("flags a model answer with no valid citation as uncited, but not the E2 line", async () => {
    const off = await run([{ model: haiku, adapter: fakeAdapter({ chunks: ["The capital of France is Paris."] }) }]);
    expect(off.at(-1)).toMatchObject({ type: "done", uncited: true });
    const bad = await run([{ model: haiku, adapter: fakeAdapter({ chunks: ["Free [vault.md#nope]."] }) }]);
    expect(bad.at(-1)).toMatchObject({ uncited: true, invalidRefCount: 1 });
    const e2 = await run([{ model: haiku, adapter: fakeAdapter({ chunks: ["That isn't covered in the NimbusStack knowledge base."] }) }]);
    expect(e2.at(-1)).toMatchObject({ uncited: false });
  });

  it("never sends provider error text to the client", async () => {
    const evs = await run([{ model: haiku, adapter: fakeAdapter({ failWith: "auth", failMessage: "invalid x-api-key sk-ant-api03-SECRET" }) }]);
    expect(JSON.stringify(evs)).not.toMatch(/sk-ant|x-api-key|SECRET/);
  });

  it("fits history to each model's window and says so when it drops turns (Review Focus 1)", async () => {
    const small = { ...haiku, contextWindow: 40_000 };   // budget 38,000 - 4,000 (system) = 34,000 estimated tokens
    const a = fakeAdapter({ chunks: ["ok [vault.md#pricing]"] });
    const messages = [
      { role: "user" as const, content: "Compare all products" }, { role: "assistant" as const, content: "y".repeat(120_000) },   // 60,000
      { role: "user" as const, content: "what about its SLA?" }];
    const evs = await run([{ model: small, adapter: a }], { messages, system: "x".repeat(8_000) });
    expect(a.lastReq!.messages).toEqual([{ role: "user", content: "what about its SLA?" }]);
    const done = evs.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.notices).toEqual([expect.objectContaining({ kind: "context", text: expect.stringMatching(/left out/) })]);
    expect(done.contextTokens).toBe(4000 + estimateTokens("what about its SLA?") + estimateTokens("ok [vault.md#pricing]"));
    const roomy = fakeAdapter({ chunks: ["ok [vault.md#pricing]"] });
    const evs2 = await run([{ model: sonnet, adapter: roomy }], { messages });
    expect(roomy.lastReq!.messages).toHaveLength(3);
    expect((evs2.at(-1) as Extract<ChatEvent, { type: "done" }>).notices).toEqual([]);
  });

  it("stopping consumption aborts the link and closes the adapter", async () => {
    let finished = false;
    let req: AdapterRequest | undefined;
    const adapter: Adapter = {
      name: "w", tested: true,
      async *stream(r: AdapterRequest): AsyncIterable<AdapterChunk> {
        req = r;
        try { yield { type: "delta", text: "a" }; yield { type: "delta", text: "b" }; } finally { finished = true; }
      },
    };
    const gen = runChain({ links: [{ model: haiku, adapter }], skipped: [], system: "sys", messages: [{ role: "user", content: "q" }],
      query: "q", signal: new AbortController().signal });
    for await (const e of gen) { if (e.type === "delta") break; }
    await new Promise((r) => setTimeout(r, 0));
    expect(req!.signal.aborted).toBe(true);
    expect(finished).toBe(true);
  });

  it("the first-token deadline is not extended by usage chunks", async () => {
    const slowUsage: Adapter = {
      name: "u", tested: true,
      async *stream(): AsyncIterable<AdapterChunk> {
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 15));
          yield { type: "usage", usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } };
        }
      },
    };
    const evs = await run([{ model: haiku, adapter: slowUsage }, { model: sonnet, adapter: fakeAdapter({ chunks: ["ok"] }) }], { firstTokenTimeoutMs: 40 });
    expect(evs.at(-1)).toMatchObject({ answeredBy: "claude-sonnet" });
  });

  it("an external abort mid-stream ends without done and aborts the link", async () => {
    const ac = new AbortController();
    const a = fakeAdapter({ chunks: ["a", "b", "c"] });
    const evs: ChatEvent[] = [];
    for await (const e of runChain({ links: [{ model: haiku, adapter: a }], skipped: [], system: "sys", messages: [{ role: "user", content: "q" }],
      query: "q", signal: ac.signal })) {
      evs.push(e);
      if (e.type === "delta") ac.abort();
    }
    expect(evs.some((e) => e.type === "done")).toBe(false);
    expect(a.lastReq!.signal.aborted).toBe(true);
  });

  it("puts the sources-only notice after the failure notices", async () => {
    const evs = await run([{ model: haiku, adapter: fakeAdapter({ failWith: "auth" }) }]);
    const done = evs.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.notices.at(-1)).toEqual(SOURCES_ONLY_NOTICE);
    expect(done.notices[0].text).toContain("Claude Haiku 4.5");
  });

  it("applies public limits: history capped with the usual notice, reply cap passed to the adapter", async () => {
    const a = fakeAdapter({ chunks: ["ok [vault.md#pricing]"] });
    const messages = [{ role: "user" as const, content: "Compare all products" }, { role: "assistant" as const, content: "y".repeat(90_000) },
      { role: "user" as const, content: "what about its SLA?" }];
    const evs = await run([{ model: sonnet, adapter: a }], { messages, limits: { historyTokens: 20_000, maxOutputTokens: 3_000, maxMessages: 40 } });
    expect(a.lastReq!.maxOutputTokens).toBe(3_000);
    expect(a.lastReq!.messages).toEqual([{ role: "user", content: "what about its SLA?" }]);   // 30,000 estimate tokens > 20,000
    expect((evs.at(-1) as Extract<ChatEvent, { type: "done" }>).notices).toEqual([{ kind: "context",
      text: "2 earlier messages were left out so the conversation fits the length this public site allows. Start a new conversation for a clean slate." }]);
    const free = fakeAdapter({ chunks: ["ok"] });
    await run([{ model: sonnet, adapter: free }], { messages });
    expect(free.lastReq!.maxOutputTokens).toBeUndefined();
    expect(free.lastReq!.messages).toHaveLength(3);
  });

  it("passes the public reply cap to every link, including a fallback", async () => {
    const first = fakeAdapter({ failWith: "unavailable" });
    const second = fakeAdapter({ chunks: ["ok"] });
    await run([{ model: sonnet, adapter: first }, { model: haiku, adapter: second }], { limits: { historyTokens: 20_000, maxOutputTokens: 3_000, maxMessages: 40 } });
    expect(first.lastReq!.maxOutputTokens).toBe(3_000);
    expect(second.lastReq!.maxOutputTokens).toBe(3_000);
  });
});
