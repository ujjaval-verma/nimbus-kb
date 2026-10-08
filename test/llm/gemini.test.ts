import { describe, expect, it } from "vitest";
import { SECTION_IDS } from "../../src/kb";
import { extractCitations } from "../../src/llm/citations";
import { getModel } from "../../src/llm/config";
import { MAX_OUTPUT_TOKENS } from "../../src/llm/context";
import { costUsd } from "../../src/llm/cost";
import { createGeminiAdapter, GEMINI_THINKING_LEVEL, type GeminiUsageMetadata, geminiUsage, mapGeminiError } from "../../src/llm/gemini";
import type { AdapterChunk, AdapterRequest, Usage } from "../../src/llm/types";
import { loadFixture, replayFetch, type SeenRequest, sseData } from "../helpers/replay";

const gemini = getModel("gemini-flash-lite")!;
const QUESTION = "What is the P1 response time for Vault Pro?";
const req = (over: Partial<AdapterRequest> = {}): AdapterRequest =>
  ({ model: gemini, system: "SYS", messages: [{ role: "user", content: QUESTION }], signal: new AbortController().signal, ...over });
const collect = async (it: AsyncIterable<AdapterChunk>) => { const o: AdapterChunk[] = []; for await (const c of it) o.push(c); return o; };
// @google/genai accepts a custom fetch (httpOptions.fetch), so the recorded response is injected, as in the Claude tests.
const replay = (name: string, seen?: SeenRequest[]) =>
  createGeminiAdapter({ apiKey: "test-key", fetch: replayFetch(loadFixture("gemini", name), seen) });
type Chunk = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; usageMetadata?: GeminiUsageMetadata };
const chunks = () => sseData(loadFixture("gemini", "stream-ok").response.body) as Chunk[];

describe("gemini adapter (replays recorded fixtures)", () => {
  it("is marked tested, and never asks for more output than the model allows", () => {
    expect(replay("stream-ok").tested).toBe(true);
    expect(MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(gemini.outputTokenLimit!);
  });

  it("assembles the recorded stream into the recorded, cited answer (thought parts excluded)", async () => {
    const expected = chunks().flatMap((c) => c.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    const text = (await collect(replay("stream-ok").stream(req()))).flatMap((c) => (c.type === "delta" ? [c.text] : [])).join("");
    expect(text).toBe(expected);
    expect(text.length).toBeGreaterThan(0);
    expect(extractCitations(text, SECTION_IDS).citedIds).toContain("vault.md#support-sla");
  });

  it("maps the recorded usage: thinking billed as output, cached prompt tokens as cache reads", async () => {
    const meta = chunks().map((c) => c.usageMetadata).filter((m): m is GeminiUsageMetadata => !!m).at(-1)!;
    const out = await collect(replay("stream-ok").stream(req()));
    const usage = (out.at(-1) as { type: "usage"; usage: Usage }).usage;
    expect(usage).toEqual(geminiUsage(meta));
    expect(usage.input + usage.cacheRead).toBe(meta.promptTokenCount);
    expect(usage.output).toBe((meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0));
    expect(costUsd(gemini, usage)).toBeGreaterThan(0);
  });

  it("geminiUsage splits cached tokens out of the prompt and never reports a cache write", () => {
    expect(geminiUsage({ promptTokenCount: 1000, cachedContentTokenCount: 600, candidatesTokenCount: 50, thoughtsTokenCount: 20 }))
      .toEqual({ input: 400, output: 70, cacheRead: 600, cacheWrite: 0 });
    expect(geminiUsage(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("sends the system prompt as systemInstruction, history as user/model turns, the output cap and the lowest thinking level", async () => {
    const seen: SeenRequest[] = [];
    await collect(replay("stream-ok", seen).stream(req({ messages: [
      { role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] })));
    expect(seen[0].url).toContain("models/gemini-3.5-flash-lite:streamGenerateContent");
    expect(seen[0].url).not.toContain("test-key");   // the key goes in a header, never the URL (URLs end up in logs)
    expect(seen[0].body).toMatchObject({
      systemInstruction: { parts: [{ text: "SYS" }] },
      contents: [{ role: "user", parts: [{ text: "a" }] }, { role: "model", parts: [{ text: "b" }] }, { role: "user", parts: [{ text: "c" }] }],
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL } },
    });
    const seenCapped: SeenRequest[] = [];
    await collect(replay("stream-ok", seenCapped).stream(req({ maxOutputTokens: 1_000 })));
    expect(seenCapped[0].body).toMatchObject({ generationConfig: { maxOutputTokens: 1_000 } });   // public reply cap (Task 13)
  });

  it.each([
    ["auth-invalid-key", "auth"],        // recorded: Google answers a bad key with 400 INVALID_ARGUMENT, reason API_KEY_INVALID
    ["bad-model", "bad_request"],        // recorded: 404 NOT_FOUND
    ["rate-limit", "rate_limit"],        // synthetic: 429 RESOURCE_EXHAUSTED, per-minute quota id
    ["quota", "quota"],                  // synthetic: 429 RESOURCE_EXHAUSTED, per-day quota id
    ["unavailable", "unavailable"],      // synthetic: 503 UNAVAILABLE
    ["safety-blocked", "bad_request"],   // synthetic: 200, finishReason SAFETY, no text
  ] as const)("classifies the %s fixture as %s", async (name, kind) => {
    await expect(collect(replay(name).stream(req()))).rejects.toMatchObject({ kind });
  });

  it("never turns MAX_TOKENS with no visible text into a silent empty answer", async () => {
    const out: AdapterChunk[] = [];
    await expect((async () => { for await (const c of replay("max-tokens-empty").stream(req())) out.push(c); })())
      .rejects.toMatchObject({ kind: "unavailable" });
    expect(out).toEqual([]);   // no empty delta, no usage: the chain moves on to the next model
  });

  it("mapGeminiError classifies by HTTP status and Google's error body", () => {
    const e = (status: number, message = "") => Object.assign(new Error(message), { status });
    expect(mapGeminiError(e(400, '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}')).kind).toBe("auth");
    expect(mapGeminiError(e(401)).kind).toBe("auth");
    expect(mapGeminiError(e(403)).kind).toBe("auth");
    expect(mapGeminiError(e(400, "Request contains an invalid argument.")).kind).toBe("bad_request");
    expect(mapGeminiError(e(404)).kind).toBe("bad_request");
    expect(mapGeminiError(e(429, "check your plan and billing details. quotaId: GenerateRequestsPerMinutePerProjectPerModel")).kind).toBe("rate_limit");
    expect(mapGeminiError(e(429, "check your plan and billing details. quotaId: GenerateRequestsPerDayPerProjectPerModel")).kind).toBe("quota");
    expect(mapGeminiError(e(429)).kind).toBe("rate_limit");
    expect(mapGeminiError(e(500)).kind).toBe("unavailable");
    expect(mapGeminiError(e(503)).kind).toBe("unavailable");
    expect(mapGeminiError(e(504)).kind).toBe("unavailable");
    expect(mapGeminiError(new TypeError("fetch failed")).kind).toBe("unavailable");
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
});
