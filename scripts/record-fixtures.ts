// Records real provider responses once, as test fixtures. Costs a few cents. Run it only when an adapter changes:
//   direnv exec . npm run record:fixtures -- --provider anthropic
// Keys come only from process.env. Request headers and bodies are never saved; responses are scrubbed before writing.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SECTIONS } from "../src/kb";
import { createClaudeApiAdapter } from "../src/llm/claude-api";
import { getModel } from "../src/llm/config";
import { buildSystemPrompt, PROMPT_VERSION } from "../src/llm/prompt";
import type { Adapter } from "../src/llm/types";
import { type Fixture, type FixtureProvider, fixturePath, KEY_PATTERNS, scrub } from "./fixtures";

const QUESTION = "What is the P1 response time for Vault Pro?";   // short, one cited table cell (E6)
const BAD_KEY = "invalid-key-for-fixture-recording";
const BAD_MODEL = "nimbus-kb-no-such-model";

interface Target { envKey: string; modelId: string; make: (apiKey: string) => Adapter }
const TARGETS: Partial<Record<FixtureProvider, Target>> = {
  // No retries: each fixture is exactly one HTTP call.
  anthropic: { envKey: "ANTHROPIC_API_KEY", modelId: "claude-sonnet", make: (apiKey) => createClaudeApiAdapter({ apiKey, maxRetries: 0 }) },
};

const provider = process.argv[process.argv.indexOf("--provider") + 1] as FixtureProvider;
const target = process.argv.includes("--provider") ? TARGETS[provider] : undefined;
if (!target) throw new Error(`usage: npm run record:fixtures -- --provider ${Object.keys(TARGETS).join("|")}`);
const key = process.env[target.envKey];
if (!key) throw new Error(`${target.envKey} is not set. Run: direnv exec . npm run record:fixtures -- --provider ${provider}`);

// Capture the one HTTP exchange each call makes. Installed before any adapter is created, so the SDKs pick it up.
type Exchange = { url: string; status: number; contentType: string; body: string };
let last: Exchange | undefined;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await realFetch(input, init);
  const body = await res.text();
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const contentType = res.headers.get("content-type") ?? "";
  last = { url, status: res.status, contentType, body };
  return new Response(body, { status: res.status, statusText: res.statusText, headers: { "content-type": contentType } });
}) as typeof fetch;

const SYSTEM = buildSystemPrompt(SECTIONS);

async function record(name: string, note: string, apiKey: string, modelName?: string): Promise<void> {
  const model = { ...getModel(target!.modelId)!, ...(modelName ? { model: modelName } : {}) };
  last = undefined;
  let outcome = "ok";
  try {
    for await (const _chunk of target!.make(apiKey).stream({ model, system: SYSTEM, messages: [{ role: "user", content: QUESTION }],
      signal: new AbortController().signal })) { /* drain */ }
  } catch (err) { outcome = (err as { kind?: string }).kind ?? "unclassified"; }
  const ex = last as Exchange | undefined;   // assigned by the fetch wrapper, which TS cannot see
  if (!ex) throw new Error(`${name}: no HTTP exchange captured`);
  const fx: Fixture = {
    provider, name, synthetic: false, recordedOn: new Date().toISOString().slice(0, 10), note,
    request: { method: "POST", url: scrub(ex.url, [key!]), model: model.model, promptVersion: PROMPT_VERSION, question: QUESTION },
    response: { status: ex.status, contentType: ex.contentType, body: scrub(ex.body, [key!]) },
  };
  const text = `${JSON.stringify(fx, null, 2)}\n`;
  if (text.includes(key!) || KEY_PATTERNS.some((re) => re.test(text))) throw new Error(`${name}: scrubbing failed, nothing written`);
  mkdirSync(dirname(fixturePath(provider, name)), { recursive: true });
  writeFileSync(fixturePath(provider, name), text);
  console.log(`${name}: HTTP ${ex.status}, adapter outcome ${outcome}`);   // never print the key or the body
}

await record("stream-ok", "One real grounded answer: the full system prompt and a short knowledge-base question.", key);
await record("auth-invalid-key", "Free call: a deliberately invalid key.", BAD_KEY);
await record("bad-model", "Free call: a model id that does not exist.", key, BAD_MODEL);
