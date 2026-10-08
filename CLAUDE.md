# Nimbus KB

Grounded product-knowledge chatbot over `nimbusstack-knowledge-base/`. Spec rationale for evaluators: `docs/decisions.md`.

## Invariants
1. No API key or key-shaped string in the browser bundle (`scripts/check-bundles.ts`). Keys reach the deployment only as Worker secrets, and the Worker registers a model only behind the public quota.
2. `src/llm/claude-sub.ts` (Claude Agent SDK) is Node-only. `src/server/worker.ts` must never import it.
3. Model metadata lives only in `src/llm/models.json`.
4. Never edit `nimbusstack-knowledge-base/`. After any KB change upstream, run `npm run gen:corpus`; a test fails if `src/kb/corpus.gen.ts` is stale.
5. Every factual answer cites section ids; the E2 line is exactly "That isn't covered in the NimbusStack knowledge base."
6. Untested paths are marked `tested: false` and labelled in the UI. The Claude API and Gemini adapters are `tested: true` because each was recorded once against its live API.
7. Changing any decision in `docs/decisions.md` means updating that file in the same commit.
8. User messages, client-sent history and model output are untrusted. Render model output only through `AnswerMarkdown` (no raw HTML, no images, only citation links clickable). The CSP lives in `src/server/security.ts` and `public/_headers`; a test keeps them identical.
9. Provider error text goes to server logs only; the browser gets plain-language notices.
10. The local Node server binds to `127.0.0.1` (it spends the developer's Claude subscription).
11. Never assume the context stays small: history is fitted per model in `src/llm/context.ts`, trimming is always announced, and the UI meter warns at 75% and 90%. A test fails if the knowledge base outgrows a quarter of the smallest model window.
12. Tests never call a provider API. Adapter tests replay scrubbed fixtures in `test/fixtures/`; re-record with `npm run record:fixtures` only when an adapter changes. Keys live in the gitignored `.envrc` (direnv); never read or print it. `test/fixtures.test.ts` fails on any key-shaped string or auth header in a fixture.
13. Every public-quota default lives in `src/server/quota.ts`; `wrangler.json` mirrors them (`vars` for the per-visitor and site-wide limits, which deployers may change; `ratelimits` for the burst limit), and tests keep the committed values equal. An invalid limit fails closed, never unlimited. The Node server never has a quota, and no IP address is ever stored.
14. The Worker first redirects http to https (308, except localhost, `src/server/https-redirect.ts`), then runs `checkSiteGate` (`src/server/site-gate.ts`) before ASSETS and the API on every path when the `SITE_PASSWORD` secret is set. Malformed credentials get a 401; unset or empty means open, with one warning; the Node server has no gate.

## Commands
- `npm run dev`: local app. Claude answers through your Claude Code login, even when `ANTHROPIC_API_KEY` is set; Gemini answers when `GEMINI_API_KEY` is set. The server logs `anthropic: <choice>` and `gemini: on|off` at startup.
- `ANTHROPIC_DEV_API=1 npm run dev`: local app on the paid Anthropic API instead (needs `ANTHROPIC_API_KEY`). `CLAUDE_SUBSCRIPTION=0` without it means no Claude at all.
- `npm run dev:worker`: the Worker in workerd; with `QUOTA_SALT` in `.dev.vars` the quota is active, and without keys every answer is sources-only.
- `npm run check`: the gate (types, lint, tests, build, bundle checks, wrangler dry run).
- `npm run eval`: Q1-Q6, edge cases and prompt-injection cases (18) against Claude; writes `evals/results/latest.md`.
- `direnv exec . npm run record:fixtures -- --provider anthropic|gemini`: re-record API fixtures (costs a few cents; only when an adapter changes).

## Where things live
`src/kb` corpus and sections · `src/llm` config, prompt, adapters, fallback, citations · `src/server` Hono app and entries · `src/web` React UI · `evals` · `test`.
