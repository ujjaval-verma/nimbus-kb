import { useMemo } from "react";
import type { Turn } from "../session";
import { AnswerMarkdown } from "./AnswerMarkdown";
import { QuotaCard } from "./QuotaCard";

const NO_CITES = new Set<string>();

function jumpTo(turnId: string, id: string) {
  const el = document.getElementById(`src-${turnId}-${id}`);
  if (!el) return;
  const details = el.querySelector("details");
  if (details) details.open = true;
  el.tabIndex = -1;
  el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
  el.classList.remove("flash");
  void el.offsetWidth;   // restart the animation if it is already running
  el.classList.add("flash");
  window.setTimeout(() => el.classList.remove("flash"), 1600);
}

export function AnswerCard({ turn, nameOf }: { turn: Turn; nameOf: (id: string) => string }) {
  const d = turn.done;
  const citedIds = useMemo(() => (d ? new Set(d.passages.map((p) => p.id)) : NO_CITES), [d]);
  const fallback = turn.failed.length ? ` · fallback from ${turn.failed.map(nameOf).join(", ")}` : "";

  let header: string | null = null;
  if (turn.status === "streaming") header = turn.attemptModelId ? `Answering with ${nameOf(turn.attemptModelId)}…` : "Answering…";
  else if (d) header = (d.answeredBy === "sources-only" ? "Sources only" : `Answered by ${nameOf(d.answeredBy)}`) + fallback;

  return (
    <article className="card answer">
      <div className="answer-head" aria-live="polite">{header}</div>
      {d?.notices.map((n, i) => (n.kind === "quota_exhausted"
        ? <QuotaCard key={i} notice={n} />
        : <p key={i} className={`callout ${n.kind === "info" ? "info" : "warn"}`}>{n.text}</p>
      ))}
      {d?.uncited && (
        <p className="badge warn" title="This answer didn't cite any document from the knowledge base, so it may not come from them.">
          No sources cited. Check before using.
        </p>
      )}
      {turn.status === "error" && <p className="error" role="alert">{turn.error}</p>}
      {turn.answer && (
        <div className="prose">
          <AnswerMarkdown markdown={turn.answer} citedIds={citedIds} onCite={(id) => jumpTo(turn.id, id)} />
        </div>
      )}
      {d && d.passages.length > 0 && (
        <section className="sources">
          <h3>Sources</h3>
          {d.passages.map((p) => (
            <div key={p.id} id={`src-${turn.id}-${p.id}`} className="source">
              <details open>
                <summary>
                  <span className="source-path">{p.headingPath}</span>
                  <span className="source-meta mono">{p.file}{p.docDate ? ` · ${p.docDate}` : ""}</span>
                </summary>
                <div className="prose"><AnswerMarkdown markdown={p.text} citedIds={NO_CITES} onCite={() => {}} /></div>
              </details>
            </div>
          ))}
        </section>
      )}
      {d && (
        <p className="usage">
          {d.answeredBy === "sources-only"
            ? <>No model used · <span className="num">$0.0000</span></>
            : <>
                <span className="num">{(d.usage.input + d.usage.cacheRead + d.usage.cacheWrite).toLocaleString("en-US")}</span> tokens in
                {" · "}<span className="num">{d.usage.output.toLocaleString("en-US")}</span> out
                {" · "}<span className="num">${d.costUsd.toFixed(4)}</span>
              </>}
        </p>
      )}
    </article>
  );
}
