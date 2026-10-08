import { describe, expect, it } from "vitest";
import { SECTION_IDS } from "../../src/kb";
import { extractCitations } from "../../src/llm/citations";
import { createClaudeApiAdapter, mapAnthropicError } from "../../src/llm/claude-api";
import { getModel } from "../../src/llm/config";
import { MAX_OUTPUT_TOKENS } from "../../src/llm/context";
import { costUsd } from "../../src/llm/cost";
import type { AdapterChunk, AdapterRequest, Usage } from "../../src/llm/types";
import { loadFixture, replayFetch, type SeenRequest, sseData } from "../helpers/replay";

const sonnet = getModel("claude-sonnet")!;
const haiku = getModel("claude-haiku")!;
const QUESTION = "What is the P1 response time for Vault Pro?";
const req = (over: Partial<AdapterRequest> = {}): AdapterRequest =>
  ({ model: sonnet, system: "SYS", messages: [{ role: "user", content: QUESTION }], signal: new AbortController().signal, ...over });
const collect = async (it: AsyncIterable<AdapterChunk>) => { const o: AdapterChunk[] = []; for await (const c of it) o.push(c); return o; };
const replay = (name: string, seen?: SeenRequest[]) =>
  createClaudeApiAdapter({ apiKey: "test-key", fetch: replayFetch(loadFixture("anthropic", name), seen), maxRetries: 0 });
type Ev = { type: string; delta?: { type: string; text?: string }; message?: { usage: Record<string, number | null> }; usage?: Record<string, number | null> };
const events = () => sseData(loadFixture("anthropic", "stream-ok").response.body) as Ev[];

const sse = (events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const handBuilt = (status: number, body: string): ReturnType<typeof loadFixture> => ({
  provider: "anthropic", name: "hand-built", synthetic: true, recordedOn: "2026-10-08", note: "Synthetic. In-test stream.",
  request: { method: "POST", url: "https://api.anthropic.com/v1/messages", model: "m", promptVersion: "n/a", question: "q" },
  response: { status, contentType: "text/event-stream", body } });
const adapterFor = (fx: ReturnType<typeof loadFixture>) => createClaudeApiAdapter({ apiKey: "test-key", fetch: replayFetch(fx), maxRetries: 0 });

describe("claude-api adapter (replays recorded fixtures)", () => {
  it("is marked tested: it was recorded against the live API", () => {
    expect(replay("stream-ok").tested).toBe(true);
  });

  it("assembles the recorded stream into the recorded, cited answer", async () => {
    const expected = events().flatMap((e) => (e.type === "content_block_delta" && e.delta?.type === "text_delta" ? [e.delta.text ?? ""] : [])).join("");
    const text = (await collect(replay("stream-ok").stream(req()))).flatMap((c) => (c.type === "delta" ? [c.text] : [])).join("");
    expect(text).toBe(expected);
    expect(text.length).toBeGreaterThan(0);
    expect(extractCitations(text, SECTION_IDS).citedIds).toContain("vault.md#support-sla");
  });

  it("maps usage from the recorded stream, including cache tokens, and prices it", async () => {
    const start = events().find((e) => e.type === "message_start")!.message!.usage;
    const end = events().filter((e) => e.type === "message_delta").at(-1)!.usage!;
    const out = await collect(replay("stream-ok").stream(req()));
    const usage = (out.at(-1) as { type: "usage"; usage: Usage }).usage;
    expect(usage).toEqual({
      input: end.input_tokens ?? start.input_tokens ?? 0, output: end.output_tokens ?? 0,
      cacheRead: end.cache_read_input_tokens ?? start.cache_read_input_tokens ?? 0,
      cacheWrite: end.cache_creation_input_tokens ?? start.cache_creation_input_tokens ?? 0 });
    expect(costUsd(sonnet, usage)).toBeGreaterThan(0);
  });

  it("sends our model, system prompt, real message roles, the output cap and effort", async () => {
    const seen: SeenRequest[] = [];
    const history = [{ role: "user" as const, content: "a" }, { role: "assistant" as const, content: "b" }, { role: "user" as const, content: "c" }];
    await collect(replay("stream-ok", seen).stream(req({ messages: history })));
    expect(seen[0].url).toContain("/v1/messages");
    expect(seen[0].body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: MAX_OUTPUT_TOKENS, system: "SYS", stream: true,
      output_config: { effort: "low" }, messages: history });
    const seenHaiku: SeenRequest[] = [];
    await collect(replay("stream-ok", seenHaiku).stream(req({ model: haiku })));
    expect(seenHaiku[0].body).toMatchObject({ model: "claude-haiku-4-5" });
    expect(seenHaiku[0].body).not.toHaveProperty("output_config");   // Haiku rejects effort
    const seenCapped: SeenRequest[] = [];
    await collect(replay("stream-ok", seenCapped).stream(req({ maxOutputTokens: 1_000 })));
    expect(seenCapped[0].body).toMatchObject({ max_tokens: 1_000 });   // the public quota's reply cap (Task 13)
  });

  it.each([
    ["auth-invalid-key", "auth"],     // recorded: 401 authentication_error
    ["bad-model", "bad_request"],     // recorded: 404 not_found_error
    ["rate-limit", "rate_limit"],     // synthetic: 429 rate_limit_error
    ["overloaded", "unavailable"],    // synthetic: 529 overloaded_error
  ] as const)("classifies the %s fixture as %s", async (name, kind) => {
    await expect(collect(replay(name).stream(req()))).rejects.toMatchObject({ kind });
  });

  it("maps errors by status and message", () => {
    const e = (status: number, message = "") => Object.assign(new Error(message), { status });
    expect(mapAnthropicError(e(429)).kind).toBe("rate_limit");
    expect(mapAnthropicError(e(401)).kind).toBe("auth");
    expect(mapAnthropicError(e(403)).kind).toBe("auth");
    expect(mapAnthropicError(e(402)).kind).toBe("quota");
    expect(mapAnthropicError(e(400, "Your credit balance is too low to access the Anthropic API.")).kind).toBe("quota");
    expect(mapAnthropicError(e(529)).kind).toBe("unavailable");
    expect(mapAnthropicError(e(500)).kind).toBe("unavailable");
    expect(mapAnthropicError(e(400)).kind).toBe("bad_request");
    expect(mapAnthropicError(e(404)).kind).toBe("bad_request");
    expect(mapAnthropicError(new TypeError("fetch failed")).kind).toBe("unavailable");
  });

  it("stops when the request is aborted, and cancels the HTTP request", async () => {
    const ac = new AbortController();
    const seen: SeenRequest[] = [];
    const it2 = replay("stream-ok", seen).stream(req({ signal: ac.signal }))[Symbol.asyncIterator]();
    expect((await it2.next()).value).toMatchObject({ type: "delta" });
    ac.abort();
    await expect(it2.next()).rejects.toThrow();
    expect(seen[0].signal?.aborted).toBe(true);
  });

  it("reports distinct cache read and write tokens in the right fields", async () => {
    const body = sse([
      { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 11, output_tokens: 1, cache_read_input_tokens: 700, cache_creation_input_tokens: 30 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
      { type: "message_stop" }]);
    const out = await collect(adapterFor(handBuilt(200, body)).stream(req()));
    expect((out.at(-1) as { usage: Usage }).usage).toEqual({ input: 11, output: 5, cacheRead: 700, cacheWrite: 30 });
  });

  it("classifies a mid-stream error event by its error type", async () => {
    const body = sse([
      { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]);
    await expect(collect(adapterFor(handBuilt(200, body)).stream(req()))).rejects.toMatchObject({ kind: "unavailable" });
    const rl = sse([{ type: "error", error: { type: "rate_limit_error", message: "slow down" } }]);
    await expect(collect(adapterFor(handBuilt(200, rl)).stream(req()))).rejects.toMatchObject({ kind: "rate_limit" });
  });

  it("maps statusless errors by their error type", () => {
    const t = (type: string | null) => mapAnthropicError(Object.assign(new Error("x"), { type }));
    expect(t("rate_limit_error").kind).toBe("rate_limit");
    expect(t("overloaded_error").kind).toBe("unavailable");
    expect(t("api_error").kind).toBe("unavailable");
    expect(t("authentication_error").kind).toBe("auth");
    expect(t("permission_error").kind).toBe("auth");
    expect(t("invalid_request_error").kind).toBe("bad_request");
    expect(t("something_else").kind).toBe("unavailable");
    expect(t(null).kind).toBe("unavailable");
    const nested = Object.assign(new Error("x"), { error: { error: { type: "rate_limit_error" } } });
    expect(mapAnthropicError(nested).kind).toBe("rate_limit");
  });
});
