export function Banner() {
  return (
    <div className="callout info" role="note">
      No AI model is set up on this deployment, so answers are the matching passages from the knowledge base, not composed answers.{" "}
      <a href="https://github.com/ujjaval-verma/nimbus-kb/blob/main/evals/results/latest.md" target="_blank" rel="noreferrer">See sample answers recorded locally</a>
      , and{" "}
      <a href="https://github.com/ujjaval-verma/nimbus-kb/blob/main/docs/decisions.md" target="_blank" rel="noreferrer">how the site is set up</a>.
    </div>
  );
}
