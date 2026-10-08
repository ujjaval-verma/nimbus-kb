import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AnswerMarkdown } from "../../src/web/components/AnswerMarkdown";

const html = (md: string, cited: string[] = ["vault.md#pricing"]) =>
  renderToStaticMarkup(<AnswerMarkdown markdown={md} citedIds={new Set(cited)} onCite={() => {}} />);

it("turns validated citations into chips", () => {
  expect(html("Pro is $35 [vault.md#pricing].")).toContain('data-cite="vault.md#pricing"');
});

it("renders unknown or not-yet-validated ids as plain text, never chips", () => {
  expect(html("Free [vault.md#nope].")).not.toContain("data-cite");
  expect(html("Pro is $35 [vault.md#pricing].", [])).not.toContain("data-cite");        // while streaming
  expect(html("[click me](#src-vault.md#nope)")).not.toContain("data-cite");             // model-written anchor
});

it("never renders model-supplied HTML, images or outside links (untrusted output)", () => {
  const out = html('<script>alert(1)</script>\n\nSee <img src="https://evil.example/a.png"> ![x](https://evil.example/?q=secret) [click](https://evil.example/login) [js](javascript:alert(1))');
  expect(out).not.toMatch(/<script|<img|<a |href=|evil\.example|javascript:/i);
  expect(out).toContain("click");   // link text survives as plain text
});
