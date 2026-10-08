import { useCallback, useEffect, useRef, useState } from "react";
import { fetchModels, streamChat, type ModelsResponse } from "./api";
import { contextUsage, meterModel } from "./context";
import { applyEvent, historyFor, totals, type Turn } from "./session";
import { Banner } from "./components/Banner";
import { Composer } from "./components/Composer";
import { ContextMeter } from "./components/ContextMeter";
import { EmptyState } from "./components/EmptyState";
import { Message } from "./components/Message";
import { ModelPicker } from "./components/ModelPicker";
import { UsagePill } from "./components/UsagePill";

const NEAR_BOTTOM_PX = 120;
const distanceFromBottom = () => document.documentElement.scrollHeight - window.scrollY - window.innerHeight;

export function App() {
  const [meta, setMeta] = useState<ModelsResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [modelId, setModelId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const stick = useRef(true);   // true while the reader is within 120px of the bottom

  useEffect(() => { fetchModels().then(setMeta).catch(() => setLoadFailed(true)); }, []);
  useEffect(() => {
    const onScroll = () => { stick.current = distanceFromBottom() < NEAR_BOTTOM_PX; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // Follow new text only if the reader had not scrolled up.
  useEffect(() => { if (stick.current) window.scrollTo({ top: document.documentElement.scrollHeight }); }, [turns]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const streaming = turns.some((t) => t.status === "streaming");
  const selectedId = modelId ?? meta?.fallbackOrder[0] ?? "";
  const selected = meta?.models.find((m) => m.id === selectedId);
  const nameOf = useCallback((id: string) => meta?.models.find((m) => m.id === id)?.name ?? id, [meta]);

  const send = useCallback((question: string) => {
    if (!meta || question.trim() === "" || streaming) return;
    const id = crypto.randomUUID();
    const ac = new AbortController();
    abortRef.current = ac;
    stick.current = true;
    const update = (fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
    const body = { modelId: selectedId, messages: historyFor(turns, question) };
    setTurns((ts) => [...ts, { id, question, answer: "", status: "streaming", failed: [] }]);
    streamChat(body, (e) => update((t) => applyEvent(t, e)), ac.signal)
      .catch(() => {
        if (ac.signal.aborted) return;
        update((t) => applyEvent(t, { type: "error", message: "Lost the connection. Please try again." }));
        ac.abort();   // cancel whatever is still open
      })
      .then(() => {
        if (ac.signal.aborted) return;
        update((t) => (t.status === "streaming" ? applyEvent(t, { type: "error", message: "The reply was cut off. Please try again." }) : t));
      });
  }, [meta, streaming, selectedId, turns]);

  const newConversation = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTurns([]);
  };

  if (loadFailed) {
    return <main className="page"><div className="callout warn" role="alert">Couldn't reach the server. Refresh to try again.</div></main>;
  }
  if (!meta || !selected) return <main className="page"><p className="muted">Loading…</p></main>;

  const anyAvailable = meta.models.some((m) => m.available);
  const metered = meterModel(meta.models, selectedId, meta.fallbackOrder);
  const usage = contextUsage({ turns, contextWindow: metered.contextWindow, systemPromptTokens: meta.systemPromptTokens, thresholds: meta.contextWarning });
  const pct = Math.min(100, Math.round(usage.ratio * 100));
  const sum = totals(turns);

  return (
    <div className="page">
      <header className="top">
        <div className="top-row">
          <h1>Nimbus KB</h1>
          <button type="button" onClick={newConversation}>New Conversation</button>
        </div>
        <ModelPicker models={meta.models} value={selectedId} onChange={setModelId} />
        <div className="top-row">
          <ContextMeter available={anyAvailable} modelName={metered.name} tokens={usage.tokens} contextWindow={metered.contextWindow}
            ratio={usage.ratio} level={usage.level} />
          <UsagePill {...sum} />
        </div>
      </header>

      {!anyAvailable && <Banner />}
      {anyAvailable && usage.level !== "ok" && (
        <div className={`callout ${usage.level === "red" ? "danger" : "warn"}`} role="status">
          <p>
            {usage.level === "amber"
              ? `This conversation is using ${pct}% of ${metered.name}'s context window. Start a new chat soon; close to the limit, earlier messages get left out of answers.`
              : `This conversation is nearly at ${metered.name}'s context limit (${pct}%). Soon earlier messages will be left out of answers. Start a new chat.`}
          </p>
          <button type="button" onClick={newConversation}>Start a new chat</button>
        </div>
      )}

      <main className="thread">
        {turns.length === 0
          ? <EmptyState onPick={send} disabled={streaming} />
          : turns.map((t) => <Message key={t.id} turn={t} nameOf={nameOf} />)}
      </main>

      <Composer streaming={streaming} onSend={send} />
    </div>
  );
}
