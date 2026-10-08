import type { Alternative, EvalCase } from "./cases";

export interface Outcome { text: string; cited: string[]; invalid: number; answeredBy: string; uncited: boolean }

const holds = (a: Alternative, o: Outcome) =>
  "exact" in a ? o.text.trim() === a.exact : "match" in a ? a.match.test(o.text) : o.cited.includes(a.cite);
const describe = (a: Alternative) => ("exact" in a ? "the exact expected line" : "match" in a ? `${a.match}` : `citation ${a.cite}`);

// Pure, so it can be checked offline against recorded answers.
export function check(c: EvalCase, o: Outcome, expectedModelId: string): string[] {
  const fails: string[] = [];
  if (o.answeredBy !== expectedModelId) fails.push(`answered by ${o.answeredBy}, not ${expectedModelId}`);
  if (o.invalid > 0) fails.push(`${o.invalid} invalid citation(s)`);
  if (o.uncited && !c.exact) fails.push("answer has no valid citation (would show the No sources cited badge)");
  for (const id of c.mustCite ?? []) if (!o.cited.includes(id)) fails.push(`missing citation ${id}`);
  for (const id of c.mustNotCite ?? []) if (o.cited.includes(id)) fails.push(`unexpected citation ${id}`);
  for (const re of c.mustMatch ?? []) if (!re.test(o.text)) fails.push(`text does not match ${re}`);
  for (const re of c.mustNotMatch ?? []) if (re.test(o.text)) fails.push(`text matches forbidden ${re}`);
  if (c.exact && o.text.trim() !== c.exact) fails.push("text is not the exact expected line");
  if (c.anyOf && !c.anyOf.some((a) => holds(a, o))) fails.push(`none of: ${c.anyOf.map(describe).join(" | ")}`);
  return fails;
}
