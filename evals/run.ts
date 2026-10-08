import { mkdirSync, writeFileSync } from "node:fs";
import { SECTIONS } from "../src/kb";
import { createClaudeSubAdapter } from "../src/llm/claude-sub";
import { CONFIG, getModel } from "../src/llm/config";
import { runChain } from "../src/llm/fallback";
import { buildSystemPrompt, PROMPT_VERSION } from "../src/llm/prompt";
import type { ChatEvent, ChatMessage } from "../src/llm/types";
import { CASES } from "./cases";
import { check } from "./check";

const modelId = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : CONFIG.fallbackOrder[0];
const model = getModel(modelId);
if (!model || model.provider !== "anthropic") throw new Error(`eval needs an anthropic model, got ${modelId}`);
// `--case E4,I1` reruns only those cases and leaves evals/results/latest.md untouched (it records full runs only).
const caseArg = process.argv.includes("--case") ? process.argv[process.argv.indexOf("--case") + 1] : undefined;
const only = caseArg ? new Set(caseArg.split(",")) : undefined;
const selected = only ? CASES.filter((c) => only.has(c.id)) : CASES;
if (only && selected.length !== only.size) throw new Error(`unknown case id in --case ${caseArg}`);
const adapter = createClaudeSubAdapter();
const system = buildSystemPrompt(SECTIONS);

async function ask(messages: ChatMessage[]) {
  let text = "";
  let done: Extract<ChatEvent, { type: "done" }> | undefined;
  for await (const e of runChain({ links: [{ model: model!, adapter }], skipped: [], system, messages,
    query: messages.at(-1)!.content, signal: new AbortController().signal, firstTokenTimeoutMs: 60_000 })) {
    if (e.type === "attempt" || e.type === "reset") text = "";
    if (e.type === "delta") text += e.text;
    if (e.type === "done") done = e;
  }
  return { text, done: done! };
}

const rows: string[] = [];
let failed = 0, totalCost = 0;
for (const c of selected) {
  const history: ChatMessage[] = [...(c.history ?? [])];
  const answers: { turn: string; text: string; done: Extract<ChatEvent, { type: "done" }> }[] = [];
  for (const turn of c.turns) {
    history.push({ role: "user", content: turn });
    const r = await ask(history);
    history.push({ role: "assistant", content: r.text });
    answers.push({ turn, ...r });
  }
  const last = answers.at(-1)!;
  // Cost and tokens cover every turn of the case, so the rows add up to the header total.
  const caseCost = answers.reduce((n, a) => n + a.done.costUsd, 0);
  const tokensIn = answers.reduce((n, a) => n + a.done.usage.input + a.done.usage.cacheRead + a.done.usage.cacheWrite, 0);
  const tokensOut = answers.reduce((n, a) => n + a.done.usage.output, 0);
  totalCost += caseCost;
  const cited = last.done.passages.map((p) => p.id);
  const fails = check(c, { text: last.text, cited, invalid: last.done.invalidRefCount, answeredBy: last.done.answeredBy,
    uncited: last.done.uncited }, model.id);
  if (fails.length) failed++;
  console.log(`${fails.length ? "FAIL" : "PASS"} ${c.id} ${c.label}${fails.length ? `\n  - ${fails.join("\n  - ")}` : ""}`);
  rows.push(`## ${c.id}: ${c.label} (${fails.length ? "FAIL" : "PASS"})\n\n` +
    (c.history ? `*Prefilled history (sent by a tampered client):*\n\n${c.history.map((m) => `> **${m.role}:** ${m.content}`).join("\n>\n")}\n\n` : "") +
    answers.map((a) => `> ${a.turn}\n\n${a.text}`).join("\n\n") + "\n\n" +
    `<sub>${last.done.answeredBy} · ${answers.length > 1 ? `${answers.length} turns · ` : ""}${tokensIn} in · ${tokensOut} out · $${caseCost.toFixed(4)} · ` +
    `cited${answers.length > 1 ? " in the last answer" : ""}: ${cited.join(", ") || "none"}</sub>` +
    (fails.length ? `\n\nFailed checks: ${fails.join("; ")}` : ""));
}

if (only) {
  console.log(`\n${selected.length - failed}/${selected.length} passed (filtered run, latest.md not written), $${totalCost.toFixed(4)}`);
  process.exit(failed ? 1 : 0);
}
mkdirSync("evals/results", { recursive: true });
writeFileSync("evals/results/latest.md",
  `# Sample answers\n\nRecorded locally with ${model.name} (\`${model.model}\`), prompt ${PROMPT_VERSION}, on ${new Date().toLocaleDateString("en-CA")}. ` +
  `${CASES.length - failed}/${CASES.length} passed. Total estimated cost at API list prices: $${totalCost.toFixed(4)}.\n\n` +
  `These are the brief's six sample questions, its edge cases and four prompt-injection attempts, run with the same prompt, fallback chain and citation code as the app, through the local Claude subscription adapter (which sends prior turns as tagged text, where the live API adapter sends real message roles). The public site allows only a few answers a day per visitor, so this page shows every case in one place.\n\n` +
  rows.join("\n\n---\n\n") + "\n");
console.log(`\n${CASES.length - failed}/${CASES.length} passed, $${totalCost.toFixed(4)}`);
process.exit(failed ? 1 : 0);
