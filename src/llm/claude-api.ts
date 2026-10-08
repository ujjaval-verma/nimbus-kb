// Claude through the Anthropic API. Runs on Cloudflare Workers and Node.
// Recorded once against the live API (scripts/record-fixtures.ts); the tests replay those fixtures offline.
import Anthropic from "@anthropic-ai/sdk";
import { MAX_OUTPUT_TOKENS } from "./context";
import { type Adapter, type AdapterChunk, ProviderError } from "./types";

export function mapAnthropicError(err: unknown): ProviderError {
  const status = (err as { status?: unknown })?.status;
  const msg = err instanceof Error ? err.message : String(err);
  if (typeof status !== "number") {
    // A mid-stream SSE `error` event throws an APIError with no status; the API's error type is on `.type`
    // (and in the parsed body at `.error.error.type`).
    const e = err as { type?: unknown; error?: { error?: { type?: unknown } } };
    const type = typeof e?.type === "string" ? e.type : e?.error?.error?.type;
    if (type === "rate_limit_error") return new ProviderError("rate_limit", msg);
    if (type === "authentication_error" || type === "permission_error") return new ProviderError("auth", msg);
    if (type === "invalid_request_error") return new ProviderError("bad_request", msg);
    return new ProviderError("unavailable", msg);   // overloaded_error, api_error, network errors, anything unknown
  }
  if (status === 429) return new ProviderError("rate_limit", msg);
  if (status === 401 || status === 403) return new ProviderError("auth", msg);
  // An empty prepaid balance comes back as a 400 invalid_request_error, not a 402.
  if (status === 402 || (status === 400 && /credit balance/i.test(msg))) return new ProviderError("quota", msg);
  if (status >= 500) return new ProviderError("unavailable", msg);
  return new ProviderError("bad_request", msg);
}

export function createClaudeApiAdapter(opts: { apiKey: string; fetch?: typeof fetch; maxRetries?: number }): Adapter {
  // No SDK retries (the SDK retries twice by default): the fallback chain is the retry, and a retry would only delay it.
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: opts.maxRetries ?? 0, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  return {
    name: "claude-api", tested: true,
    async *stream(req): AsyncIterable<AdapterChunk> {
      try {
        const stream = client.messages.stream(
          { model: req.model.model, max_tokens: req.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
            // The system prompt (the whole knowledge base) is identical on every call, so it is cached: later calls within
            // the cache lifetime read it at the cache-read price instead of the full input price.
            system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }], messages: req.messages,
            ...(req.model.effort ? { output_config: { effort: req.model.effort } } : {}) },
          { signal: req.signal });
        let text = "";
        for await (const e of stream) {
          if (req.signal.aborted) throw new ProviderError("unavailable", "aborted");
          if (e.type === "content_block_delta" && e.delta.type === "text_delta") { text += e.delta.text; yield { type: "delta", text: e.delta.text }; }
        }
        if (req.signal.aborted) throw new ProviderError("unavailable", "aborted");
        const final = await stream.finalMessage();
        // A refusal or an instant end_turn is never returned as if it were an answer (mirrors gemini.ts).
        if (text.trim() === "") throw new ProviderError("unavailable", `Claude returned no text (stop_reason ${final.stop_reason ?? "none"})`);
        const u = final.usage;
        yield { type: "usage", usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 } };
      } catch (err) {
        throw err instanceof ProviderError ? err : mapAnthropicError(err);
      }
    },
  };
}
