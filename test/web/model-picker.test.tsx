import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ModelPicker } from "../../src/web/components/ModelPicker";

const model = (o: Record<string, unknown>) => ({ id: "x", provider: "anthropic", providerLabel: "Anthropic", model: "x", name: "X",
  description: "D.", contextWindow: 200_000, pricePerMTok: { input: 1, output: 5 }, status: "implemented", available: true, tested: true, ...o }) as never;

it("shows the provider once, prices in plain words, and no repeated placeholder wording", () => {
  const models = [
    model({ id: "claude-sonnet", name: "Claude Sonnet 5.5", description: "The default." }),
    model({ id: "openai", providerLabel: "OpenAI", name: "GPT-6 Luna", description: "Not implemented in this build.",
      pricePerMTok: { input: 0.1, output: 0.5 }, status: "placeholder", available: false, tested: false }),
  ];
  const html = renderToStaticMarkup(<ModelPicker models={models} value="openai" onChange={() => {}} />);
  expect(html).toContain("Anthropic: Claude Sonnet 5.5 · The default.");
  expect(html).toContain("OpenAI: GPT-6 Luna · Not implemented in this build.</option>");
  expect(html).not.toContain("(placeholder, not implemented)");
  expect(html).toContain("$0.10 in, $0.50 out per million tokens");
  expect(html).toContain("Placeholder, not implemented");   // the badge stays
});
