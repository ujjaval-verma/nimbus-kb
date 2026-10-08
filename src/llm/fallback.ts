import { SECTION_IDS, getSection } from "../kb";
import type { Section } from "../kb/sections";
import { extractCitations } from "./citations";
import type { ModelConfig } from "./config";
import { estimateTokens, fitToWindow, historyBudget } from "./context";
import { costUsd } from "./cost";
import { noticeFor, trimmedNotice } from "./notices";
import { sourcesOnlyEvents } from "./sources-only";
import { type Adapter, type AdapterChunk, type ChatEvent, type ChatMessage, NOT_COVERED, type Notice, ProviderError, toPassage, type Usage, ZERO_USAGE } from "./types";

export interface ChainLink { model: ModelConfig; adapter: Adapter }
export interface RunChainOptions {
  links: ChainLink[]; skipped: Notice[]; system: string; messages: ChatMessage[];
  query: string; signal: AbortSignal; firstTokenTimeoutMs?: number; sections?: Section[];
}

async function nextWithTimeout(it: AsyncIterator<AdapterChunk>, ms: number | null): Promise<IteratorResult<AdapterChunk>> {
  if (ms === null) return it.next();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProviderError("unavailable", `no first token within ${ms} ms`)), ms);
  });
  try { return await Promise.race([it.next(), timeout]); } finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function* runChain(o: RunChainOptions): AsyncGenerator<ChatEvent> {
  const notices: Notice[] = [...o.skipped];
  const firstMs = o.firstTokenTimeoutMs ?? 20_000;
  const systemTokens = estimateTokens(o.system);

  for (const { model, adapter } of o.links) {
    if (o.signal.aborted) return;
    yield { type: "attempt", modelId: model.id };
    let text = "";
    let streamed = false;
    let usage: Usage = ZERO_USAGE;
    // Each link gets history fitted to its own window (a smaller backup model may need more trimming).
    const fit = fitToWindow(o.messages, historyBudget(model, systemTokens));
    // Each link gets its own abort signal, so a timed-out or failed attempt is really cancelled (not left spending).
    const linkAc = new AbortController();
    const onAbort = () => linkAc.abort();
    o.signal.addEventListener("abort", onAbort, { once: true });
    let it: AsyncIterator<AdapterChunk> | undefined;
    try {
      it = adapter.stream({ model, system: o.system, messages: fit.messages, signal: linkAc.signal })[Symbol.asyncIterator]();
      for (;;) {
        const r = await nextWithTimeout(it, streamed ? null : firstMs);
        if (r.done) break;
        if (r.value.type === "delta") { streamed = true; text += r.value.text; yield { type: "delta", text: r.value.text }; }
        else usage = r.value.usage;
      }
      const { citedIds, invalidRefCount } = extractCitations(text, SECTION_IDS);
      yield {
        type: "done", answeredBy: model.id, usage, costUsd: costUsd(model, usage),
        passages: citedIds.map((id) => toPassage(getSection(id)!)), invalidRefCount,
        uncited: citedIds.length === 0 && text.trim() !== NOT_COVERED,
        contextTokens: systemTokens + fit.messages.reduce((n, m) => n + estimateTokens(m.content), 0) + estimateTokens(text),
        notices: fit.dropped > 0 ? [...notices, trimmedNotice(model.name, fit.dropped)] : notices,
      };
      return;
    } catch (err) {
      linkAc.abort();
      void it?.return?.(undefined)?.catch(() => {});
      if (o.signal.aborted) return;
      const kind = err instanceof ProviderError ? err.kind : "unavailable";
      // Raw provider errors go to server logs only; the client gets the plain-language notice.
      console.error(`[fallback] ${model.id} ${kind}:`, err);
      if (streamed) yield { type: "reset", failedModelId: model.id, kind };
      notices.push(noticeFor(model.name, kind));
    } finally {
      o.signal.removeEventListener("abort", onAbort);
    }
  }
  yield* sourcesOnlyEvents(o.query, notices, o.sections);
}
