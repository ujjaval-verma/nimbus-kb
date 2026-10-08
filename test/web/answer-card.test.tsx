import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AnswerCard } from "../../src/web/components/AnswerCard";
import type { Turn } from "../../src/web/session";

it("each source summary shows its section id in the mono style", () => {
  const turn: Turn = {
    id: "t1", question: "q", answer: "A [vault-saml-2].", status: "done", failed: [],
    done: {
      type: "done", answeredBy: "claude-sonnet", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, costUsd: 0.01,
      passages: [{ id: "vault-saml-2", file: "vault.md", headingPath: "Vault > SAML", docDate: null, text: "Body" }],
      invalidRefCount: 0, uncited: false, contextTokens: 10, notices: [],
    },
  };
  const html = renderToStaticMarkup(<AnswerCard turn={turn} nameOf={(id) => id} />);
  const summary = html.match(/<summary>.*?<\/summary>/s)?.[0] ?? "";
  expect(summary).toContain('<span class="source-id mono">vault-saml-2</span>');
});
