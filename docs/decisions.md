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

**Where retrieval still lives:** a simple keyword ranker picks passages for the sources-only fallback (decision 4), which runs when no AI provider is available.

**Revisit when:** the corpus grows past roughly 100k tokens, or changes often enough that sending all of it gets expensive. Then: hybrid keyword and embedding search with rank fusion, and the same citation checks.

## 2. A mid-tier model at low effort, not a frontier model

**Brief:** a dropdown of Claude, OpenAI and Gemini; model choice is open.

**What I built:** the default is Claude Sonnet 5.5 at low reasoning effort, with Claude Haiku 4.5 as the automatic backup. Neither is a frontier model (Anthropic's Opus and Fable tiers). Model details (description, price, context window, effort, fallback order) live in `src/llm/models.json`.

**Why:**
- With the whole corpus in front of it, the task is careful reading of 3,000 tokens: compare tiers, cite, refuse when the answer is missing, flag documents that disagree. That does not need frontier reasoning.
- Latency matters more than depth for the people this is for. A sales executive on a live customer call wants the answer in a second or two, so Sonnet runs at low effort.
- Sonnet rather than the smaller Haiku: one tier up buys a margin on the cases that are easiest to get subtly wrong (the documents that disagree, the complete cross-product answer), and keeps the eval to a single run on a single default. Haiku stays in the fallback chain, so a Sonnet outage still gets a composed answer.
- The choice is checked, not assumed: `npm run eval` runs the six sample questions, the edge cases and four prompt-injection attempts against the default model and records the answers in `evals/results/latest.md`.

**Revisit when:** evals show misses at low effort (raise effort first), or the corpus gets large and messy enough that reasoning across it gets hard.

## 3. One provider implemented and tested; the others are placeholders behind an adapter

**Brief (R3):** switch between Claude, OpenAI and Gemini, with automatic fallback to a backup provider. "A placeholder for the others is okay, tell us on the call."

**What I built:**
- All model calls go through one small `Adapter` interface (`src/llm/types.ts`): stream text, report token usage, and classify failures as rate limit, quota, auth, unavailable or bad request. The fallback chain only ever talks to that interface.
- Claude is implemented two ways: through the Anthropic API when `ANTHROPIC_API_KEY` is set, and through a local developer login for development and evals.
- OpenAI and Gemini appear in the dropdown from `models.json`, marked "Placeholder, not implemented". Adding one is a single adapter file of about 40 lines that implements the same interface; nothing else in the app changes.

**Why multi-provider was not tested end to end:** no API keys were provided for this assessment, and I chose not to create and spend my own across three vendors for a public demo. The fallback logic itself is tested offline with fake adapters that fail in every way the interface defines, including failing halfway through a reply (the partial text is discarded, so a reply never mixes two models). Once real keys are provided, a provider plugs into that same tested path.

**Why this is the prudent choice:** every provider key is a long-lived secret that can spend money. Fewer keys means fewer secrets to store, rotate and leak, and less untested code that only runs when a key happens to be present.

## 4. The public site runs with no API keys

**Brief:** "At least one provider must work on your live link." Also: an API key visible in the browser fails the assessment.

**What I built:** the live site at `nimbus.ujjaval.ca` holds no provider keys at all. Every question runs the real fallback chain, finds no provider configured, and ends at the **sources-only fallback**: it returns the most relevant passages from the knowledge base with a plain note that they are not a checked answer. When no passage matches the question's key terms, it replies "That isn't covered in the NimbusStack knowledge base." without any model call. Keyword matching is cruder than a model: a question that shares words with the documents but isn't answered by them (say, an uptime figure) gets the nearest passages rather than that line. Composed answers, recorded locally against the same code, are in `evals/results/latest.md`.

**Why, from a security standpoint:**
- The site is public and has no login (login is out of scope in the brief). A key on that server is a key anyone on the internet can spend, at whatever rate they like.
- A key that is never deployed cannot leak from the deployment: not through a misconfigured bundle, a logged request, or a compromised dependency. The build also checks that no key names or key-shaped strings end up in the browser bundle.
- The fallback chain is the same code path used when a provider is down, so the public site still exercises the error handling the brief asks for (R5, E9), and it never makes anything up because it only quotes the documents.

**Trade-off, stated plainly:** reviewers will see quoted passages on the live link, not composed answers. Running locally with a key (see the README) shows the full experience.

## 5. One SHOULD item is left out: usage export

**Usage export (CSV or JSON):** a session costs fractions of a cent. Per-message tokens and cost, plus running session totals, are shown in the UI (required by R4); exporting them adds a feature nobody here needs.

The other SHOULD item, the context-window warning, is built. See decision 7.

## 6. Platform and tooling

- **One Cloudflare Worker** serves the web app and the streaming `/api/chat` route on a custom domain. No Vercel, no separate backend, no database: the browser keeps the conversation and sends it with each request, and saving chats between sessions is out of scope.
- **No vector database, no embeddings, no RAG framework.** Official provider SDKs behind the adapter interface keep the fallback and error handling in code you can read in one sitting.

## 7. The context-window warning is built, because "the context stays small" is an assumption

**Brief (R4, SHOULD):** "Warn the user as the conversation gets close to the model's context-window limit (amber at 75%, red at 90%), and update the warning when they switch models." E7: switching to a model with a smaller window updates the warning right away.

**What I built:**
- A context meter in the header. It counts what the next request would put in the window: the system prompt, the conversation the model actually received, and its answers. It counts at 3 characters per token, which overcounts on purpose, and uses exactly the same count the server uses for trimming, so the warnings always come before anything is left out.
- Amber at 75% and red at 90% of the selected model's window (thresholds in `models.json`), each with a "Start a new chat" button. The meter recalculates as soon as the model changes, so moving from Sonnet (1M tokens) to Haiku (200K) updates it at once (E7).
- The server fits history to each model's own window (`src/llm/context.ts`), so a smaller backup model gets a smaller budget. Trimming starts only past 95% on the meter's scale. If older turns have to be left out, the answer says so in a notice. History is never cut silently and never rejected for length.
- A test fails if the knowledge base grows past a quarter of the smallest model window, and its message points back to decision 1 (switch to retrieval).

**Why, given decision 1 says the corpus is small:** the corpus is small today, but conversations, model choices and the documents can all change. An early draft cut history at a fixed 24,000 characters without telling anyone, which is exactly the kind of quiet failure this assessment is about. Measuring real usage and announcing any trimming costs little and keeps the app honest when the assumption stops holding.

**On the live site** no model runs, so the meter reads "n/a".

## 8. Prompt injection and untrusted output

**Brief:** answers must come from the documents (an automatic fail otherwise), and keys must never reach the browser.

**Threat model:** the knowledge base and the system prompt are public in this repo, so leaking them costs nothing. The model has no tools, so it cannot read files, browse or act. The browser holds the conversation, so a user who tampers with it only affects their own chat. What is left to defend is the grounding guarantee, the user's browser, and the developer's Claude login during local use.

**What I built:**
- **Prompt rules.** Documents and messages are information, not instructions. Requests to ignore the rules, take on a role, use outside knowledge or go off-topic get the NimbusStack part answered, or the exact "That isn't covered in the NimbusStack knowledge base." line. Earlier assistant turns are not treated as evidence, because the browser sends them and could have edited them.
- **Checked, not assumed.** Four eval cases try this: an "ignore your instructions" request, an off-topic question, a false claim planted in the question, and a forged assistant turn in the history.
- **A visible flag.** If a model answer cites no document and is not the "not covered" line, it shows a "No sources cited. Check before using." badge.
- **Model output is treated as untrusted.** Answers render with no raw HTML, no images and no clickable outside links (only the citation chips). A strict Content Security Policy on every response blocks outside images, scripts and connections even if something slipped through.
- **The local developer path is locked down.** The Agent SDK runs with no tools, no MCP servers, no claude.ai connectors and no local settings, and refuses to answer if it reports loading any. The local server listens only on `127.0.0.1` and rejects requests addressed to any other host name, so a malicious web page cannot reach it through DNS rebinding. History sent through it is tagged and escaped so a user cannot fake a turn. A timed-out attempt is cancelled, not left running.
- **Hygiene.** Provider error text stays in server logs; the browser only gets plain-language notices. Requests are JSON-only and size-capped. The full git history is scanned for secrets before the repo goes public.

**Not built, on purpose:** signing the conversation so the browser cannot edit earlier turns. Anyone who forges their own history only fools themselves, and signing would add a server secret to protect. Rate limiting is also left out because the live site has no key to spend; the README says to add it before anyone deploys this with one.
