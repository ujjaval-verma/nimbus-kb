import { useId } from "react";
import type { ModelInfo } from "../api";

function suffix(m: ModelInfo): string {
  if (m.status === "placeholder") return " (placeholder, not implemented)";
  if (!m.available) return " (not configured here)";
  if (!m.tested) return " (untested)";
  return "";
}

export function ModelPicker({ models, value, onChange }: { models: ModelInfo[]; value: string; onChange: (id: string) => void }) {
  const id = useId();
  const sel = models.find((m) => m.id === value);
  return (
    <div className="picker">
      <label htmlFor={id} className="sr-only">Model</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {models.map((m) => (
          <option key={m.id} value={m.id}>{`${m.providerLabel}: ${m.name} · ${m.description}${suffix(m)}`}</option>
        ))}
      </select>
      {sel && (
        <p className="picker-desc">
          {`${sel.description} · ${sel.contextWindow / 1000}K context · $${sel.pricePerMTok.input}/$${sel.pricePerMTok.output} per MTok`}
          {sel.status === "placeholder" && <span className="badge warn">Placeholder, not implemented</span>}
          {sel.status === "implemented" && !sel.available && <span className="badge warn">Not configured here</span>}
          {sel.available && !sel.tested && <span className="badge warn">Untested</span>}
        </p>
      )}
    </div>
  );
}
