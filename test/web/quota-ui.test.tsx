import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { quotaNotice } from "../../src/llm/notices";
import { QuotaCard, REPO_URL } from "../../src/web/components/QuotaCard";
import { QuotaPill } from "../../src/web/components/QuotaPill";

it("the pill shows the answers left today, and nothing without a quota or with none left", () => {
  expect(renderToStaticMarkup(<QuotaPill quota={{ limit: 10, remaining: 3 }} />)).toContain("3 of 10 answers left today");
  expect(renderToStaticMarkup(<QuotaPill quota={{ limit: 4, remaining: 2 }} />)).toContain("2 of 4 answers left today");   // the configured limit, not a constant
  expect(renderToStaticMarkup(<QuotaPill quota={null} />)).toBe("");
  expect(renderToStaticMarkup(<QuotaPill quota={{ limit: 10, remaining: 0 }} />)).toBe("");
});

it("the card says the limit is reached and how to run it yourself", () => {
  // The card shows the server's notice text, which carries the configured limit; the component has no number of its own.
  const html = renderToStaticMarkup(<QuotaCard notice={{ kind: "quota_exhausted", text: "You've used today's 10 answers. Run it yourself for unlimited answers." }} />);
  expect(html).toContain("You&#x27;ve used today&#x27;s 10 answers. Run it yourself for unlimited answers.");
  expect(REPO_URL).toBe("https://github.com/ujjaval-verma/nimbus-kb");
  expect(html).toContain(`href="${REPO_URL}"`);
  for (const t of ["Anthropic", "Gemini", ".env.example", "npm install &amp;&amp; npm run dev"]) expect(html).toContain(t);
  expect(html).not.toMatch(/API_KEY/);              // no key env names in client code: the bundle check forbids them
  expect(html).not.toMatch(/deploy\.workers/);      // no Deploy to Cloudflare link (user decision)
  expect(html).not.toMatch(/<img|\u2014/);          // the CSP allows no outside images; the copy has no em dashes
});

it("the pill reads correctly for a limit of 1 and of 10", () => {
  expect(renderToStaticMarkup(<QuotaPill quota={{ limit: 1, remaining: 1 }} />)).toContain("1 of 1 answer left today");
  expect(renderToStaticMarkup(<QuotaPill quota={{ limit: 10, remaining: 1 }} />)).toContain("1 of 10 answers left today");
  expect(renderToStaticMarkup(<QuotaPill quota={{ limit: 10, remaining: 10 }} />)).toContain("10 of 10 answers left today");
});

it("the notice reads correctly for a limit of 1 and of 10", () => {
  expect(quotaNotice("visitor", 1).text).toBe("You've used today's 1 answer. Run it yourself for unlimited answers.");
  expect(quotaNotice("visitor", 10).text).toBe("You've used today's 10 answers. Run it yourself for unlimited answers.");
});
