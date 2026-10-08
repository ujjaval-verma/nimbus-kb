import type { ContextLevel } from "../context";

export function ContextMeter({ available, modelName, tokens, contextWindow, ratio, level, capped = false }: {
  available: boolean; modelName: string; tokens: number; contextWindow: number; ratio: number; level: ContextLevel;
  capped?: boolean }) {   // capped: the public site's history cap, not the model's window, sets the limit
  if (!available) {
    return <span className="meter-na mono" title="No AI model runs on this deployment, so nothing fills a context window.">Context n/a</span>;
  }
  const pct = Math.min(100, Math.round(ratio * 100));
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
      aria-label={`Context used for ${modelName}`} title={`${tokens.toLocaleString("en-US")} of ${contextWindow.toLocaleString("en-US")} tokens${capped ? " (this public site caps each conversation)" : ""}`}>
      <div className="meter-bar"><div className={`meter-fill ${level}`} style={{ width: `${pct}%` }} /></div>
      <span className="mono">{pct}% context</span>
    </div>
  );
}
