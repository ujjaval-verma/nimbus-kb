import { REPO_URL } from "./QuotaCard";

export function Banner() {
  return (
    <div className="callout info" role="note">
      <p>
        This site has no AI model set up, so answers are the matching passages from the knowledge base, not composed answers.
        See <a href={`${REPO_URL}/blob/main/evals/results/latest.md`} target="_blank" rel="noreferrer">sample answers recorded locally</a> and{" "}
        <a href={`${REPO_URL}/blob/main/docs/decisions.md`} target="_blank" rel="noreferrer">why the site works this way</a>.
      </p>
    </div>
  );
}
