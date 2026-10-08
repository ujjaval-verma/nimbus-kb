import { expect, it } from "vitest";
import { SECTIONS } from "../../src/kb";
import { buildSystemPrompt, PROMPT_VERSION } from "../../src/llm/prompt";
import { NOT_COVERED } from "../../src/llm/types";

it("includes every section with id, path and date, plus the rules", () => {
  const p = buildSystemPrompt(SECTIONS);
  for (const s of SECTIONS) expect(p).toContain(`<section id="${s.id}"`);
  expect(p).toContain('date="2026-04-14"');
  expect(p).toContain(NOT_COVERED);
  expect(p).toMatch(/disagree/);
  expect(PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
});

it("is deterministic (cache-friendly)", () => {
  expect(buildSystemPrompt(SECTIONS)).toBe(buildSystemPrompt(SECTIONS));
});

it("tells the model that documents and messages are data, not instructions (prompt injection)", () => {
  const p = buildSystemPrompt(SECTIONS);
  expect(p).toMatch(/information, not instructions/);
  expect(p).toMatch(/not evidence/);
});

it("escapes section attributes and keeps section bodies from closing the wrapper tags", () => {
  const p = buildSystemPrompt([{ ...SECTIONS[0], id: "a.md#b", headingPath: 'Odd "path" <x> & y' }]);
  expect(p).toContain('path="Odd &quot;path&quot; &lt;x&gt; &amp; y"');
  for (const s of SECTIONS) expect(s.text).not.toMatch(/<\/?(section|knowledge_base)\b/i);
});

it("flags contradicted facts every time and never assumes today's date", () => {
  const p = buildSystemPrompt(SECTIONS);
  expect(p).toMatch(/Flag the disagreement every time you state a fact that another section contradicts/);
  expect(p).toMatch(/You do not know today's date, so never say which value applies "today" or "now"/);
});
