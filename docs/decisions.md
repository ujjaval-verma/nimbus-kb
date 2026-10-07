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

## 2. A small, fast model by default, chosen by evals

**Brief:** a dropdown of Claude, OpenAI and Gemini; model choice is open.

**What I built:** the default is Claude Haiku 4.5, a small model, not a frontier one. Model details (description, price, context window, fallback order) live in `src/llm/models.json`.

**Why:**
- With the whole corpus in front of it, the task is careful reading of 3,000 tokens: compare tiers, cite, refuse when the answer is missing, flag documents that disagree. That does not need frontier reasoning.
- Latency matters more than depth for the people this is for. A sales executive on a live customer call wants the answer in a second or two.
- The choice is tested, not assumed: `npm run eval` runs the six sample questions and the edge cases against the chosen model. If the small model fails the disagreement or refusal cases, the default moves up a tier and the eval report shows why.

**Revisit when:** evals show the small model missing cases, or the corpus gets large and messy enough that reasoning across it gets hard.

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

**What I built:** the live site at `nimbus.ujjaval.ca` holds no provider keys at all. Every question runs the real fallback chain, finds no provider configured, and ends at the **sources-only fallback**: it returns the most relevant passages from the knowledge base with a plain note that they are not a checked answer. Questions the knowledge base does not cover get "That isn't covered in the NimbusStack knowledge base." without any model call. Composed answers, recorded locally against the same code, are in `evals/results/latest.md`.

**Why, from a security standpoint:**
- The site is public and has no login (login is out of scope in the brief). A key on that server is a key anyone on the internet can spend, at whatever rate they like.
- A key that is never deployed cannot leak from the deployment: not through a misconfigured bundle, a logged request, or a compromised dependency. The build also checks that no key names or key-shaped strings end up in the browser bundle.
- The fallback chain is the same code path used when a provider is down, so the public site still exercises the error handling the brief asks for (R5, E9), and it never makes anything up because it only quotes the documents.

**Trade-off, stated plainly:** reviewers will see quoted passages on the live link, not composed answers. Running locally with a key (see the README) shows the full experience.

## 5. The two SHOULD items are left out

- **Context-window warning (amber at 75%, red at 90%):** the whole knowledge base is about 3,000 tokens and the models' windows are 200,000 or more. A conversation would need around a hundred long exchanges to reach the amber line, so the warning would never appear in real use.
- **Usage export (CSV or JSON):** a session costs fractions of a cent. Per-message tokens and cost, plus running session totals, are shown in the UI (required by R4); exporting them adds a feature nobody here needs.

## 6. Platform and tooling

- **One Cloudflare Worker** serves the web app and the streaming `/api/chat` route on a custom domain. No Vercel, no separate backend, no database: the browser keeps the conversation and sends it with each request, and saving chats between sessions is out of scope.
- **No vector database, no embeddings, no RAG framework.** Official provider SDKs behind the adapter interface keep the fallback and error handling in code you can read in one sitting.
