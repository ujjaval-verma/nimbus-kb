import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { quotaNotice } from "../../src/llm/notices";
import { QuotaCard, REPO_URL } from "../../src/web/components/QuotaCard";
import { QuotaPill } from "../../src/web/components/QuotaPill";

const pill = (limit: number, remaining: number) => renderToStaticMarkup(<QuotaPill quota={{ limit, remaining }} />);
const text = (html: string) => html.replace(/<[^>]+>/g, "");   // the count sits in its own <span class="num">

it("the pill shows how many answers are left, and says so when none are", () => {
  expect(text(pill(10, 3))).toBe("3 answers left today");
  expect(text(pill(10, 1))).toBe("1 answer left today");
  expect(text(pill(1, 1))).toBe("1 answer left today");
  expect(text(pill(10, 0))).toBe("No answers left today");
  expect(renderToStaticMarkup(<QuotaPill quota={null} />)).toBe("");
});

it("the pill's title carries the configured limit and the UTC reset", () => {
  expect(pill(4, 2)).toContain('title="Each visitor gets 4 AI answers a day on this public demo. Resets at midnight UTC."');
  expect(pill(1, 1)).toContain('title="Each visitor gets 1 AI answer a day on this public demo. Resets at midnight UTC."');
});

it("the notice reads correctly for a limit of 1 and of 10, and for the site cap", () => {
  expect(quotaNotice("visitor", 1).text).toBe("You've used all of today's answers (1 a day per visitor). They reset at midnight UTC.");
  expect(quotaNotice("visitor", 10).text).toBe("You've used all of today's answers (10 a day per visitor). They reset at midnight UTC.");
  expect(quotaNotice("site", 300).text).toBe("This demo has used all of today's answers for everyone. They reset at midnight UTC.");
});

it("the card shows the notice and how to run it yourself", () => {
  const html = renderToStaticMarkup(<QuotaCard notice={quotaNotice("visitor", 10)} />);
  expect(html).toContain("You&#x27;ve used all of today&#x27;s answers (10 a day per visitor). They reset at midnight UTC.");
  expect(html).toContain("To keep going, run it yourself (no daily limit):");
  expect(html).toContain(`href="${REPO_URL}"`);
  expect(REPO_URL).toBe("https://github.com/ujjaval-verma/nimbus-kb");
  for (const t of ["Sign in to Claude Code", "Gemini API key", ".env.example", "npm install &amp;&amp; npm run dev"]) expect(html).toContain(t);
  expect(html).toContain(`href="${REPO_URL}/blob/main/evals/results/latest.md"`);
  expect(html).not.toMatch(/API_KEY/);              // no key env names in client code: the bundle check forbids them
  expect(html).not.toMatch(/deploy\.workers/);      // no Deploy to Cloudflare link (user decision)
  expect(html).not.toMatch(/<img|\u2014/);          // the CSP allows no outside images; the copy has no em dashes
});
