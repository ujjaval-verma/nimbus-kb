import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { App } from "../../src/web/App";
import { Composer } from "../../src/web/components/Composer";

it("renders the page frame before the model list arrives, not a bare loading line", () => {
  const html = renderToStaticMarkup(<App />);   // effects do not run: this is the first paint
  expect(html).toContain('<header class="top"');
  expect(html).toContain("Nimbus KB");
  expect(html).toContain('class="composer"');
  expect(html).toMatch(/<select[^>]*disabled/);
  expect(html).not.toContain("Loading…</p>");
});

it("a disabled composer disables both the box and Send", () => {
  const html = renderToStaticMarkup(<Composer streaming={false} disabled onSend={() => {}} />);
  expect(html).toMatch(/<textarea[^>]*disabled/);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
});
