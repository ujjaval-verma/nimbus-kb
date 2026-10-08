const QUESTIONS = [
  "What are the key differences between the Pro and Enterprise pricing tiers?",
  "Does Vault integrate with Salesforce? What version is required?",
  "What new features were released in v4.2 of Relay?",
  "A client is getting a 403 on the API. What should they check first?",
  "Which of our products support SSO via SAML 2.0?",
  "What's the SLA for Priority 1 support tickets?",
];

export function EmptyState({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) {
  return (
    <section className="empty">
      <h2>Ask about NimbusStack's four products.</h2>
      <p>Every answer cites the documents it came from.</p>
      <div className="suggestions">
        {QUESTIONS.map((q) => (
          <button key={q} type="button" className="suggestion" disabled={disabled} onClick={() => onPick(q)}>{q}</button>
        ))}
      </div>
    </section>
  );
}
