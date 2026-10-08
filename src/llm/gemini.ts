// Gemini through Google's @google/genai SDK. Runs on Cloudflare Workers and Node.
// Recorded once against the live API (scripts/record-fixtures.ts); the tests replay those fixtures offline.
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { MAX_OUTPUT_TOKENS } from "./context";
import { type Adapter, type AdapterChunk, type ChatMessage, ProviderError, type Usage } from "./types";

// Gemini 3.x thinks by default, and thinking tokens count against maxOutputTokens: with a tiny cap the reply is cut
// before any visible text. Ask for the least thinking the model accepts (this job is careful reading, not reasoning)
// and keep the full MAX_OUTPUT_TOKENS cap so thinking cannot starve the answer.
export const GEMINI_THINKING_LEVEL = ThinkingLevel.MINIMAL;

export interface GeminiUsageMetadata { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number }

// Thinking tokens are billed at the output price, so they count as output. promptTokenCount includes implicitly
// cached tokens, which are billed at the cache-read price. Gemini charges nothing to write its implicit cache.
export function geminiUsage(m: GeminiUsageMetadata | undefined): Usage {
  const cacheRead = m?.cachedContentTokenCount ?? 0;
  return { input: (m?.promptTokenCount ?? 0) - cacheRead, output: (m?.candidatesTokenCount ?? 0) + (m?.thoughtsTokenCount ?? 0), cacheRead, cacheWrite: 0 };
}

export function toGeminiContents(messages: ChatMessage[]): { role: "user" | "model"; parts: { text: string }[] }[] {
  return messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
}

export function mapGeminiError(err: unknown): ProviderError {
  const status = (err as { status?: unknown })?.status;
  const msg = err instanceof Error ? err.message : String(err);
  if (typeof status !== "number") return new ProviderError("unavailable", msg);   // network failure, timeout
  // Google answers an invalid key with 400 INVALID_ARGUMENT (reason API_KEY_INVALID), not 401.
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid/i.test(msg)) return new ProviderError("auth", msg);
  // 429 RESOURCE_EXHAUSTED means a per-minute limit (try again shortly) or a daily quota. Both carry the same
  // "check your plan and billing" message; only the quota id in the error details tells them apart.
  if (status === 429) return new ProviderError(/PerDay/i.test(msg) ? "quota" : "rate_limit", msg);
  if (status >= 500) return new ProviderError("unavailable", msg);
  return new ProviderError("bad_request", msg);   // 400, 404 (unknown model), other 4xx
}

// Finish reasons where Gemini withheld or cut the answer for policy reasons.
const BLOCKED = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "LANGUAGE", "IMAGE_SAFETY"]);

export function createGeminiAdapter(opts: { apiKey: string; fetch?: typeof fetch }): Adapter {
  // No SDK retries: the fallback chain is the retry (httpOptions.retryOptions, attempts 1 means no retries).
  const ai = new GoogleGenAI({ apiKey: opts.apiKey, httpOptions: { retryOptions: { attempts: 1 }, ...(opts.fetch ? { fetch: opts.fetch } : {}) } });
  return {
    name: "gemini", tested: true,
    async *stream(req): AsyncIterable<AdapterChunk> {
      try {
        const stream = await ai.models.generateContentStream({
          model: req.model.model,
          contents: toGeminiContents(req.messages),
          config: { systemInstruction: req.system, maxOutputTokens: req.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
            thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL }, abortSignal: req.signal },
        });
        let text = "";
        let finish: string | undefined;
        let meta: GeminiUsageMetadata | undefined;
        for await (const chunk of stream) {
          if (req.signal.aborted) throw new ProviderError("unavailable", "aborted");
          if (chunk.promptFeedback?.blockReason) throw new ProviderError("bad_request", `Gemini blocked the prompt: ${chunk.promptFeedback.blockReason}`);
          const cand = chunk.candidates?.[0];
          finish = cand?.finishReason ?? finish;
          meta = chunk.usageMetadata ?? meta;
          for (const part of cand?.content?.parts ?? []) {
            if (part.thought || !part.text) continue;   // thought summaries are not part of the answer
            if (req.signal.aborted) throw new ProviderError("unavailable", "aborted");
            text += part.text;
            yield { type: "delta", text: part.text };
          }
        }
        if (req.signal.aborted) throw new ProviderError("unavailable", "aborted");
        // A blocked reply is an error even after some text (the chain resets and moves on). An empty reply, for example
        // MAX_TOKENS spent entirely on thinking, is never returned as if it were an answer.
        if (finish && BLOCKED.has(finish)) throw new ProviderError("bad_request", `Gemini stopped: ${finish}`);
        if (text.trim() === "") throw new ProviderError("unavailable", `Gemini returned no text (finishReason ${finish ?? "none"})`);
        yield { type: "usage", usage: geminiUsage(meta) };
      } catch (err) {
        throw err instanceof ProviderError ? err : mapGeminiError(err);
      }
    },
  };
}
