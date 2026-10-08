# Nimbus KB

> *Answers about NimbusStack's products, taken only from its own documents, with the sources one click away.*

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue?style=flat-square" alt="TypeScript 5.9"/>
  <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square" alt="React 19"/>
  <img src="https://img.shields.io/badge/Cloudflare-Workers%20%2B%20Hono-f38020?style=flat-square" alt="Cloudflare Workers and Hono"/>
  <img src="https://img.shields.io/badge/tested%20with-Vitest-success?style=flat-square" alt="Tested with Vitest"/>
</p>

**Try it:** https://nimbus.ujjaval.ca

The public site has no AI keys by design, so it answers with the matching passages from the knowledge base instead of a composed answer. The composed answers, from Claude Sonnet 5.5 running locally, are in [`evals/results/latest.md`](evals/results/latest.md), and the reasons are in [`docs/decisions.md`](docs/decisions.md).

<div align="center">
  <img src="docs/media/screenshot.png" alt="Nimbus KB running locally: Claude Sonnet 5.5 answers which products support SAML 2.0, product by product, with citation chips after each claim and the Vault disagreement called out" width="600"/>
  <br><sub>Q5 locally, answered by Claude Sonnet 5.5. Every claim carries a citation chip, and the Vault documents that disagree are both cited.</sub>
</div>

Nimbus KB is an internal chatbot for NimbusStack staff: sales on a live call, support chasing an error, trainers onboarding new hires. It answers from the 10 markdown files in [`nimbusstack-knowledge-base/`](nimbusstack-knowledge-base/) and nothing else. If the documents don't cover a question, it says "That isn't covered in the NimbusStack knowledge base." If two documents disagree, it cites both and says which is newer.

## How it meets the brief

| Requirement | How | Live / Local |
|---|---|---|
| R1 Chat | Streamed replies over SSE, the conversation kept in the browser and sent with each question, a **New Conversation** button. | Live |
| R2 Grounding | The whole knowledge base (32 sections, about 3,000 tokens) goes to the model with a stable id per section. The model cites ids inline, the server checks each one, and the cited passages appear under the answer. With no model, a keyword ranker picks the passages. | Live (passages) |
| R3 Model switching | Dropdown from `src/llm/models.json` with provider name and description. Claude and Gemini are implemented, each recorded once against its live API and tested offline with fixtures. OpenAI is a placeholder. Fallback order: Sonnet, Gemini 3.5 Flash-Lite, Haiku, then passages. | Dropdown live. Fallback: Local only (see evals/results/latest.md) |
| R4 Usage | Input and output tokens and cost on every answer, session totals in the header, priced from `models.json`. | Local only (see evals/results/latest.md) |
| R4 Context warning | A meter in the header, amber at 75% and red at 90% of the selected model's window, each with **Start a new chat**. History that would overflow is trimmed oldest first, with a notice. | Local only (see evals/results/latest.md) |
| R5 Backend | Every request goes through the Hono server, which streams the reply and reports the model that actually answered, its usage and its passages. Keys stay on the server. | Live |
| Q1-Q6 | All six pass with cited answers, grouped per product when the question names none. | Local only (see evals/results/latest.md). Live shows the matching passages |
| E1 Follow-up without the product | The model gets the whole conversation and resolves "its" from it. | Local only (see evals/results/latest.md) |
| E2 Not in the documents | Exactly "That isn't covered in the NimbusStack knowledge base." | Live when no passage matches. Local for model answers |
| E3 Partly covered | Answers the covered part and names what is missing. | Local only (see evals/results/latest.md) |
| E4 Documents disagree | Cites both and says which is newer (the Vault SAML case in the screenshot). | Local only (see evals/results/latest.md) |
| E5 Loose wording | The model reads every section, so "single sign-on" finds SAML and "federated login". | Local only (see evals/results/latest.md) |
| E6 One table value | Values are quoted with their row and column labels. | Local only (see evals/results/latest.md) |
| E7 Model switch | Built: the context meter recalculates as soon as the model changes. | Local only |
| E8 Provider fails mid-reply | The server sends a reset, the browser drops the partial text, and the backup's answer is labelled "fallback from ...". | Local only (see [Demo the fallback](#demo-the-fallback)) |
| E9 Rate limits and errors | Plain-language notices with a next step. Provider error text stays in server logs. | Live (notices for unconfigured models) |
| E10 Blank message | Rejected in the browser and again on the server (400), with no provider call. | Live |
| Auto-fail: keys in the browser | No key ever reaches the browser. `npm run check`, which every `npm run deploy` runs first, fails if one does. The live site holds no keys at all. | Live |
| Auto-fail: answers not from the documents | Prompt rules, server-checked citations, a "No sources cited" badge, 18 eval cases. The live site only quotes passages. | Live (passages). Local for model answers |
| Prompt injection | Prompt rules, untrusted rendering, a strict CSP, eval cases I1-I4. | Rendering and CSP live. I1-I4 local |

## Decisions

Where I followed the brief, where I pushed back, and why. Full text in [`docs/decisions.md`](docs/decisions.md).

- [The corpus, measured](docs/decisions.md#the-corpus-measured): 10 files, about 3,000 tokens. Every decision starts from that number.
- [1. The whole knowledge base goes to the model](docs/decisions.md#1-the-whole-knowledge-base-goes-to-the-model-instead-of-retrieving-passages-first), instead of retrieving passages first. Recall is 100% by construction.
- [2. A mid-tier model at low effort](docs/decisions.md#2-a-mid-tier-model-at-low-effort-not-a-frontier-model): Claude Sonnet 5.5, then Gemini 3.5 Flash-Lite on another provider, then Claude Haiku 4.5.
- [3. Two providers implemented and tested](docs/decisions.md#3-two-providers-implemented-and-tested-openai-is-a-placeholder-behind-the-same-adapter), OpenAI a placeholder behind the same adapter interface.
- [4. Keys on the public site](docs/decisions.md#4-the-public-site-has-real-keys-behind-a-daily-quota), and the caps that bound the spend.
- [5. Usage export left out](docs/decisions.md#5-one-should-item-is-left-out-usage-export): a session costs fractions of a cent.
- [6. Platform and tooling](docs/decisions.md#6-platform-and-tooling): one Cloudflare Worker, no vector database, official SDKs.
- [7. The context-window warning is built](docs/decisions.md#7-the-context-window-warning-is-built-because-the-context-stays-small-is-an-assumption), because "the context stays small" is an assumption.
- [8. Prompt injection and untrusted output](docs/decisions.md#8-prompt-injection-and-untrusted-output): what is defended and how.

## Run it locally

**Requires:** Node 24 or later. Optional: Claude Code, logged in (Claude answers through that login), an Anthropic API key, a Gemini API key.

```bash
git clone https://github.com/ujjaval-verma/nimbus-kb.git
cd nimbus-kb
npm install
cp .env.example .env   # optional
npm run dev            # open the URL Vite prints
```

At startup the API server logs `anthropic: <choice>` and `gemini: on|off`, so you can see which providers are live.

- `ANTHROPIC_API_KEY`: used by the deployed Worker. Local dev ignores it unless `ANTHROPIC_DEV_API=1`.
- `ANTHROPIC_DEV_API`: set to `1` (with `ANTHROPIC_API_KEY`) to make `npm run dev` use the paid Anthropic API instead of your Claude Code login.
- `GEMINI_API_KEY`: turns on Gemini 3.5 Flash-Lite, which is also the first backup when Claude fails.
- `CLAUDE_SUBSCRIPTION`: local dev uses your Claude Code login by default. Set it to `0` if you have none; without `ANTHROPIC_DEV_API=1` there is then no Claude, and answers come from Gemini or as passages.
- `FAULT_INJECT`: forces a failure to demo the fallback, for example `claude-sonnet:rate_limit` or `claude-sonnet:midstream`.

Keys can live in `.env`, or with [direnv](https://direnv.net/) in a gitignored `.envrc` (`export GEMINI_API_KEY=...`). Even with `ANTHROPIC_API_KEY` in your shell, local dev keeps using the Claude Code login until you set `ANTHROPIC_DEV_API=1`, so a loaded key never spends money by accident.

### Tests and fixtures

`npm test` needs no key and no network: a setup file makes every `fetch` throw, and the adapter tests replay recorded responses from `test/fixtures/`. `direnv exec . npm run record:fixtures -- --provider anthropic|gemini` re-records them (a few cents), and only needs to run when an adapter changes. Responses that are expensive or impractical to provoke (rate limits, outages, safety blocks) are hand-written and marked `"synthetic": true`. A test fails if any fixture holds a key-shaped string or an auth header.

## Demo the fallback

```bash
FAULT_INJECT=claude-sonnet:midstream npm run dev
```

Ask any question with Claude Sonnet 5.5 selected. Sonnet starts streaming, then fails mid-reply. Its partial text disappears, and the answer comes from Gemini 3.5 Flash-Lite if `GEMINI_API_KEY` is set, otherwise from Claude Haiku 4.5. The card header says "fallback from Claude Sonnet 5.5", and a notice says what went wrong. Other kinds to try: `rate_limit`, `quota`, `auth`, `unavailable`, `bad_request`.

## Architecture

```
browser (React 19)  -- POST /api/chat, SSE back -->  Hono app (Worker in production, Node locally)
                                                      | validate, fit history, prompt with all 32 sections
fallback chain:  Claude Sonnet 5.5  ->  Gemini 3.5 Flash-Lite  ->  Claude Haiku 4.5
                                                      | one Adapter interface: stream text, report usage, classify errors
adapters:  Claude API  ·  Gemini API  ·  Claude Code login (Node only)
                                                      | every model failed, or none configured
sources-only:  keyword-ranked passages, no model call
```

One Cloudflare Worker serves the React app as static assets and the Hono API under `/api/*`. Locally the same Hono app runs on Node at `127.0.0.1:8787` behind Vite, and adds the Claude Code login adapter and fault injection. Nothing is stored on the server: the browser keeps the conversation.

<details>
<summary>Source layout</summary>

```
nimbusstack-knowledge-base/   the 10 source documents (never edited)
src/
  kb/        corpus.gen.ts (generated), section parser, keyword search for sources-only
  llm/       models.json, prompt, context fitting, fallback chain, citations, cost, notices,
             adapters: claude-api.ts, gemini.ts, claude-sub.ts (Node only)
  server/    app.ts (Hono), worker.ts, node.ts, security.ts (CSP)
  web/       React UI: App, components, SSE parser, session state, context meter maths
public/_headers   the same security headers for static assets
scripts/     gen-corpus, record-fixtures, check-bundles
evals/       18 cases, runner, results/latest.md
test/        Vitest, mirroring src/, plus recorded fixtures in test/fixtures/
```

</details>

<details>
<summary>Every script</summary>

| Script | What it does |
|---|---|
| `npm run dev` | API server on Node plus the Vite dev server |
| `npm run dev:worker` | The Worker in workerd with no keys (models unavailable, sources-only) |
| `npm test` | `vitest run`, offline |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | ESLint |
| `npm run build` | `vite build` (client and Worker) |
| `npm run check` | Types, lint, tests, build, bundle checks, `wrangler deploy --dry-run` |
| `npm run eval` | Q1-Q6, edge cases and prompt-injection cases (18) against Claude, writes `evals/results/latest.md` |
| `npm run record:fixtures` | Re-records the API fixtures (needs keys, costs a few cents) |
| `npm run gen:corpus` | Regenerates `src/kb/corpus.gen.ts` from the knowledge base |
| `npm run deploy` | `npm run check`, then `wrangler deploy` |
| `npm run cf-typegen` | Regenerates Worker binding types |

</details>

## Known limitations

- **The live site has no keys.** It quotes passages; composed answers are only in [`evals/results/latest.md`](evals/results/latest.md) or on your machine.
- **OpenAI is a placeholder.** It is in the dropdown, marked as such, and can't answer.
- **Tests replay API fixtures recorded once.** A change in a provider's API shows up in the tests only when someone re-records them.
- **Failed attempts aren't counted.** Tokens spent by a model that failed before the fallback answered are not in the usage totals.
- **The keyword fallback would not scale.** It is fine for 32 sections; a large corpus would need real search.
- **Token counts before the first reply are estimates** (characters divided by 3), as are the turns after the last reply.
- **The browser holds the history,** so a user can edit their own past turns. That only affects their own chat, and the prompt treats earlier assistant turns as not evidence.

## Security

- **Keys never reach the browser.** `scripts/check-bundles.ts` fails `npm run check` (and so every `npm run deploy`) if a key name or key-shaped string is in the browser bundle, or if the Claude Code login adapter is in the Worker bundle. The live site holds no keys at all.
- **Test fixtures are scrubbed**, and a test fails on any key-shaped string or auth header in them.
- **Prompt injection:** prompt rules 11 and 12 treat documents and messages as information, not instructions, and earlier assistant turns as not evidence. The model has no tools. Answers render with no raw HTML, no images and no outside links, behind a strict Content Security Policy. Eval cases I1-I4 try the attacks, and an answer that cites nothing gets a "No sources cited" badge.
- **The local server listens on `127.0.0.1` only**, because it can spend your Claude Code login.

> **Before putting `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` on a public deployment, add rate limiting** (for example Cloudflare's Workers rate limiting binding, keyed by client IP). This build does not include it, because the live site has no key.
