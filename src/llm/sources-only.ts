import { SECTIONS } from "../kb";
import { searchSections } from "../kb/keyword";
import type { Section } from "../kb/sections";
import { PASSAGES_NOTICE, SOURCES_ONLY_NOTICE } from "./notices";
import { type ChatEvent, type Notice, NOT_COVERED, toPassage, ZERO_USAGE } from "./types";

function excerpt(text: string): string {
  const flat = text.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
}

export function sourcesOnlyEvents(query: string, notices: Notice[], sections: Section[] = SECTIONS): ChatEvent[] {
  const hits = searchSections(query, sections, 5);
  // The quota stopped the models (they could answer), so "No AI model could answer" would contradict the quota card.
  const closing = notices.some((n) => n.kind === "quota_exhausted") ? PASSAGES_NOTICE : SOURCES_ONLY_NOTICE;
  const done = (passages: Section[], extra: Notice[]): ChatEvent => ({
    type: "done", answeredBy: "sources-only", usage: ZERO_USAGE, costUsd: 0,
    passages: passages.map(toPassage), invalidRefCount: 0, uncited: false, contextTokens: 0, notices: [...notices, ...extra],
  });
  if (hits.length === 0) return [{ type: "delta", text: NOT_COVERED }, done([], [closing])];
  const lines = hits.map((s) => `- **${s.headingPath}**: ${excerpt(s.text)} [${s.id}]\n`);
  return [...lines.map((text): ChatEvent => ({ type: "delta", text })), done(hits, [closing])];
}
