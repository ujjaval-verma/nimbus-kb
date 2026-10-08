# Decisions and pushback on the brief

The brief says some parts are "left open on purpose" and that "your choices are part of what we assess". This page records where I followed the brief, where I pushed back on it from first principles, and why. Each decision says what would make me revisit it.

## The corpus, measured

The knowledge base is 10 markdown files: 10,112 bytes, 1,775 words, about 3,000 tokens, split into 32 sections by `##` headings. Every decision below starts from that number. A modern model's context window is 50 to 400 times larger than the entire knowledge base.

## 1. The whole knowledge base goes to the model, instead of retrieving passages first

**Brief (R2):** "Find the relevant parts of the documents before calling the AI model. Every answer shows the passages it came from."

**What I built:** every request sends all 32 sections to the model, each labelled with a stable ID such as `vault.md#pricing`. The model cites those IDs inline. The server checks every cited ID exists, and the UI shows exactly those sections under the answer.

**Why:**
- Retrieval exists to fit a large corpus into a small window. At 3,000 tokens there is nothing to fit, so retrieval only adds a way to be wrong: if the right passage is not retrieved, the model cannot answer from it.
- The brief's hardest questions are retrieval failures waiting to happen. Q5 ("which of our products support SAML?") is only correct if every product's sign-in section comes back. E1 ("what about its SLA?") needs the product carried over from earlier turns. E5 ("single sign-on") needs synonym matching to find "SAML" and "federated login". An early design review of a retrieval pipeline for this corpus found three bugs of exactly this kind. With the full corpus in context, recall is 100% by construction and the model handles wording and follow-ups itself.
- The second half of R2 is kept, and made stronger: the passages shown are the ones the answer actually cited, not the ones a ranker guessed were relevant.

**Where retrieval still lives:** a simple keyword ranker picks passages for the sources-only fallback (decision 4), which runs when no AI provider is available or the public site's daily quota is used up.

**Revisit when:** the corpus grows past roughly 100k tokens, or changes often enough that sending all of it gets expensive. Then: hybrid keyword and embedding search with rank fusion, and the same citation checks.

## 2. A mid-tier model at low effort, not a frontier model

**Brief:** a dropdown of Claude, OpenAI and Gemini; model choice is open.

**What I built:** the default is Claude Sonnet 5.5 at low reasoning effort. If it fails, Gemini 3.5 Flash-Lite answers, and after that Claude Haiku 4.5. None of them is a frontier model (Anthropic's Opus and Fable tiers). Model details (description, price, context window, effort, fallback order) live in `src/llm/models.json`.

**Why:**
- With the whole corpus in front of it, the task is careful reading of 3,000 tokens: compare tiers, cite, refuse when the answer is missing, flag documents that disagree. That does not need frontier reasoning.
- Latency matters more than depth for the people this is for. A sales executive on a live customer call wants the answer in a second or two, so Sonnet runs at low effort.
- Sonnet rather than the smaller Haiku: one tier up buys a margin on the cases that are easiest to get subtly wrong (the documents that disagree, the complete cross-product answer), and keeps the eval to a single run on a single default.
- The first backup is on another provider. A second Claude model does not help when Anthropic itself is down or my account hits a limit, so Gemini 3.5 Flash-Lite comes before Haiku. It is fast and cheap, which suits a backup that should rarely run. Haiku stays last, so a Sonnet outage still gets a composed answer even without a Gemini key.
- The choice is checked, not assumed: `npm run eval` runs the six sample questions, the edge cases and four prompt-injection attempts against the default model and records the answers in `evals/results/latest.md`.

**Result:** Claude Sonnet 5.5 at low effort passed 18 of 18 cases with prompt 2026-10-07.2, including four prompt-injection attempts; the full run cost $0.14 at API list prices. Checks are keyword and citation heuristics; each answer was also fact-checked by hand against the knowledge base. See `evals/results/latest.md`.

**Revisit when:** evals show misses at low effort (raise effort first), or the corpus gets large and messy enough that reasoning across it gets hard.

## 3. Two providers implemented and tested; OpenAI is a placeholder behind the same adapter

**Brief (R3):** switch between Claude, OpenAI and Gemini, with automatic fallback to a backup provider. "A placeholder for the others is okay, tell us on the call."

**What I built:**
- All model calls go through one small `Adapter` interface (`src/llm/types.ts`): stream text, report token usage, and classify failures as rate limit, quota, auth, unavailable or bad request. The fallback chain only ever talks to that interface.
- Claude is implemented two ways: through the Anthropic API with `ANTHROPIC_API_KEY` (on the Worker, or locally with `ANTHROPIC_DEV_API=1`), and through the developer's Claude Code login, which local development uses by default and the evals always use.
- Gemini is implemented through Google's API when `GEMINI_API_KEY` is set. It is the cross-provider backup (decision 2).
- OpenAI appears in the dropdown from `models.json`, marked "Placeholder, not implemented". Adding it is one adapter file that implements the same interface; nothing else in the app changes.

**How the providers are tested:** each API adapter runs against its live API once: one real answer to a short question with the full knowledge base in the prompt, one call with a deliberately invalid key, and one with a model name that does not exist. The last two cost nothing. The responses are saved as test fixtures, with keys scrubbed, and the tests replay them offline. Errors that are expensive or impractical to trigger on purpose, like rate limits, outages and a reply cut off before any text, are hand-written fixtures marked as synthetic. The fallback chain itself is tested with fake adapters that fail in every way the interface defines, including failing halfway through a reply (the partial text is discarded, so a reply never mixes two models). One manual run checks the real thing: Sonnet is forced to fail and Gemini answers.

**Why record once and replay:** the live calls cost a few cents, once. After that the tests are fast and give the same result every time, and they need no key, so anyone can run them from a fresh clone and a CI job would need no secrets. A test also fails if a fixture ever contains anything shaped like a key.

**Why two providers, not three:** every provider key is a long-lived secret that can spend money. Two providers are enough for a real cross-provider fallback; a third adds another secret to store, rotate and leak without making the answers better.

## 4. The public site has real keys, behind a daily quota

**Brief:** "At least one provider must work on your live link." Also: an API key visible in the browser fails the assessment.

**What I built:** the live site at `nimbus.ujjaval.ca` answers with Claude Sonnet 5.5, with Gemini 3.5 Flash-Lite as the backup. Both keys are Worker secrets: they stay on Cloudflare's servers and never reach the browser, and the build checks that no key names or key-shaped strings end up in the browser bundle. The keys are only used behind a quota, capped three ways:
- **Per visitor:** 10 model answers a day, enough for the six sample questions and a few follow-ups. A visitor is an IP address (for IPv6, the /64 block a home or server usually gets).
- **Site-wide:** 300 model answers a day, for everyone together. That is 30 people using their full allowance, far more than this demo should see.
- **Per request:** at most 60,000 bytes of conversation history (about 15,000 tokens of English) in at most 40 messages, a 3,000-token reply (the longest eval answer was 2,172 tokens, and a reply cut short can lose its citations), and about 3 questions every 10 seconds. History is measured in bytes, not characters, because text like Chinese or emoji takes several bytes, and up to one token per byte, for each character.

The per-visitor and site-wide numbers are settings in `wrangler.json`, so anyone deploying their own copy can change them. A value that isn't a positive whole number switches the models off and logs why. It never means unlimited.

A question counts once, even if Claude fails and Gemini answers, and a question no model answered doesn't count, unless a model had already streamed part of a reply before failing (it was billed). Composed answers for every eval case are also in `evals/results/latest.md`, and running the app locally has no limit. Once the quota is used up, the site still answers, with the most relevant passages from the knowledge base and a card that shows how to run it yourself in three steps. When no passage matches the question's key terms, it replies "That isn't covered in the NimbusStack knowledge base." without any model call. Keyword matching is cruder than a model: a question that shares words with the documents but isn't answered by them (say, an uptime figure) gets the nearest passages rather than that line. The Worker only turns the models on when the quota is set up, so a half-configured deploy serves passages, not open keys.

**Why caps, not keys-free:** quoted passages alone hide the product the brief asks for. The system prompt is about 7,000 tokens and is cached, so repeat questions read it at a tenth of the input price. At Sonnet's list prices a typical question costs about a cent. Tokenizers use at most one token per byte, so the byte cap bounds a request at about 60,000 history tokens in any language. The worst request then costs about $0.15 with a warm cache and $0.17 without, so a full day of 300 is $46 to $50. The largest English request is about 15,000 history tokens, $0.06 to $0.08, and a normal day costs far less. A failed attempt can still be billed: if Sonnet, Gemini and Haiku all fail after being billed for the full request, one question costs about $0.28, and a full day about $84. That is the ceiling, because a question counts once any model has streamed text. The hard bound on money is the spend limit at the providers.

**Why per-IP limits alone are not protection:** anyone can change their IP address with a phone network or a VPN, so the per-visitor limit only stops one person from using up the day for everyone else. What bounds the spend is the site-wide cap and, behind it, limits at the providers: a monthly spend limit on the Anthropic workspace that holds the key, and a budget alert on the Google Cloud project for the Gemini key.

**Privacy:** the quota never stores an IP address, only a hash of it salted with a secret and the date, so the same visitor can't be linked from one day to the next. Old days are deleted.

**Accepted risks, stated plainly:**
- Everyone behind one IP address (an office, a campus) shares the same 10 answers.
- There is no CAPTCHA, so a determined bot can use up the day's 300 answers. The cap holds the cost, and the card points people to running it themselves.

**Revisit when:** abuse shows up in the logs (add Cloudflare Turnstile), or real use outgrows 300 answers a day.

## 5. One SHOULD item is left out: usage export

**Usage export (CSV or JSON):** a session costs fractions of a cent. Per-message tokens and cost, plus running session totals, are shown in the UI (required by R4); exporting them adds a feature nobody here needs.

The other SHOULD item, the context-window warning, is built. See decision 7.

## 6. Platform and tooling

- **One Cloudflare Worker** serves the web app and the streaming `/api/chat` route on a custom domain. No Vercel, no separate backend, and no database for conversations: the browser keeps the conversation and sends it with each request, and saving chats between sessions is out of scope. The only stored state is the public site's daily quota counter, a Durable Object (with SQLite) holding hashed visitor counts.
- **No vector database, no embeddings, no RAG framework.** Official provider SDKs behind the adapter interface keep the fallback and error handling in code you can read in one sitting.

## 7. The context-window warning is built, because "the context stays small" is an assumption

**Brief (R4, SHOULD):** "Warn the user as the conversation gets close to the model's context-window limit (amber at 75%, red at 90%), and update the warning when they switch models." E7: switching to a model with a smaller window updates the warning right away.

**What I built:**
- A context meter in the header. It counts what the next request would put in the window: the system prompt, the conversation the model actually received, and its answers. It counts at 3 characters per token, which overcounts on purpose, and uses exactly the same count the server uses for trimming, so the warnings always come before anything is left out.
- Amber at 75% and red at 90% of the selected model's window (thresholds in `models.json`), each with a "Start a new conversation" button. The meter recalculates as soon as the model changes, so moving from Sonnet (1M tokens) to Haiku (200K) updates it at once (E7).
- The server fits history to each model's own window (`src/llm/context.ts`), so a smaller backup model gets a smaller budget. Trimming starts only past 95% on the meter's scale. If older turns have to be left out, the answer says so in a notice. History is never cut silently and never rejected for length.
- A test fails if the knowledge base grows past a quarter of the smallest model window, and its message points back to decision 1 (switch to retrieval).

**Why, given decision 1 says the corpus is small:** the corpus is small today, but conversations, model choices and the documents can all change. An early draft cut history at a fixed 24,000 characters without telling anyone, which is exactly the kind of quiet failure this assessment is about. Measuring real usage and announcing any trimming costs little and keeps the app honest when the assumption stops holding.

**On the live site** history is capped at 60,000 bytes (about 15,000 tokens of English) in at most 40 messages to keep each answer's cost small (decision 4), so the meter measures against that cap. For English text within 40 messages its warnings still come before anything is left out; otherwise the trim notice still says what was left out. The cap is the same for every model, so switching from Sonnet to Haiku there does not move the meter (E7), and amber and red only show in a long conversation within the cap. Both are visible running locally, where each model has its own window.

## 8. Prompt injection and untrusted output

**Brief:** answers must come from the documents (an automatic fail otherwise), and keys must never reach the browser.

**Threat model:** the knowledge base and the system prompt are public in this repo, so leaking them costs nothing. The model has no tools, so it cannot read files, browse or act. The browser holds the conversation, so a user who tampers with it only affects their own chat. What is left to defend is the grounding guarantee, the user's browser, the provider keys on the live site (decision 4), and the developer's Claude login during local use.

**What I built:**
- **Prompt rules.** Documents and messages are information, not instructions. Requests to ignore the rules, take on a role, use outside knowledge or go off-topic get the NimbusStack part answered, or the exact "That isn't covered in the NimbusStack knowledge base." line. Earlier assistant turns are not treated as evidence, because the browser sends them and could have edited them.
- **Checked, not assumed.** Four eval cases try this: an "ignore your instructions" request, an off-topic question, a false claim planted in the question, and a forged assistant turn in the history.
- **A visible flag.** If a model answer cites no document and is not the "not covered" line, it shows a "No sources cited. Check before using." badge.
- **Model output is treated as untrusted.** Answers render with no raw HTML, no images and no clickable outside links (only the citation chips). A strict Content Security Policy on every response blocks outside images, scripts and connections even if something slipped through.
- **The local developer path is locked down.** The Agent SDK runs with no tools, no MCP servers, no claude.ai connectors and no local settings, and refuses to answer if it reports loading any. The local server listens only on `127.0.0.1` and rejects requests addressed to any other host name, so a malicious web page cannot reach it through DNS rebinding. History sent through it is tagged and escaped so a user cannot fake a turn. A timed-out attempt is cancelled, not left running.
- **Hygiene.** Provider error text stays in server logs; the browser only gets plain-language notices. Requests are JSON-only and size-capped. The full git history is scanned for secrets before the repo goes public.

**Not built, on purpose:** signing the conversation so the browser cannot edit earlier turns. Anyone who forges their own history only fools themselves, and signing would add a server secret to protect. Rate limiting is built, as part of the quota in decision 4.
