import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ModelPicker } from "../../src/web/components/ModelPicker";

const model = (o: Record<string, unknown>) => ({ id: "x", provider: "anthropic", providerLabel: "Anthropic", model: "x", name: "X",
  label: "L.", description: "D.", contextWindow: 200_000, pricePerMTok: { input: 1, output: 5 }, status: "implemented", available: true, tested: true, ...o }) as never;

const LONG = "The default. Careful, cited answers across all four products.";
const models = [
  model({ id: "claude-sonnet", name: "Claude Sonnet 5.5", label: "The default.", description: LONG }),
  model({ id: "gemini-flash-lite", provider: "google", providerLabel: "Google", name: "Gemini 3.5 Flash-Lite", label: "First backup.",
    description: "Google's fast, low-cost model. The cross-provider backup.", available: false, tested: false }),
  model({ id: "openai", providerLabel: "OpenAI", name: "GPT-6 Luna", label: "Not implemented.", description: "Not implemented in this build.",
    pricePerMTok: { input: 0.1, output: 0.5 }, status: "placeholder", available: false, tested: false }),
];

it("shows short labels in the options, never the long description", () => {
  const html = renderToStaticMarkup(<ModelPicker models={models} value="openai" onChange={() => {}} />);
  expect(html).toContain(">Anthropic: Claude Sonnet 5.5 · The default.</option>");
  expect(html).toContain(">OpenAI: GPT-6 Luna · Not implemented.</option>");
  expect(html).toContain("First backup. (not configured here)</option>");
  expect(html).not.toContain("Careful, cited answers");
  expect(html).not.toContain("(placeholder, not implemented)");
  expect(html).toContain("$0.10 in, $0.50 out per million tokens");
  expect(html).toContain("Placeholder, not implemented");   // the badge stays
});

it("keeps the full description in the picker-desc paragraph", () => {
  const html = renderToStaticMarkup(<ModelPicker models={models} value="claude-sonnet" onChange={() => {}} />);
  expect(html).toMatch(/<p class="picker-desc">The default\. Careful, cited answers across all four products\./);
});
