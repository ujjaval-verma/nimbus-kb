import type { Notice } from "../../llm/types";

export const REPO_URL = "https://github.com/ujjaval-verma/nimbus-kb";

// Our own static UI, not model output, so the repo link is fine; no outside image, so the CSP is unchanged.
// No key env names here: scripts/check-bundles.ts fails the build on them anywhere in the client bundle.
export function QuotaCard({ notice }: { notice: Notice }) {
  return (
    <section className="quota-card" aria-label="Daily answers used up">
      <p className="quota-title">{notice.text}</p>
      <p>To keep going, run it yourself (no daily limit):</p>
      <ol>
        <li>Clone <a href={REPO_URL} target="_blank" rel="noopener noreferrer">the repo</a>.</li>
        <li>Sign in to Claude Code, or add a Gemini API key to a <code>.env</code> file. To use an Anthropic API key instead, see <code>.env.example</code>.</li>
        <li>Run <code>npm install && npm run dev</code>.</li>
      </ol>
      <p>Or read the <a href={`${REPO_URL}/blob/main/evals/results/latest.md`} target="_blank" rel="noopener noreferrer">sample answers recorded locally</a>.</p>
    </section>
  );
}
