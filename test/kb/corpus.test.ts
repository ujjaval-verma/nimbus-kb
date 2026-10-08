import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { OUT, renderCorpus } from "../../scripts/gen-corpus";

it("corpus.gen.ts is up to date with the knowledge base (run npm run gen:corpus)", () => {
  expect(readFileSync(OUT, "utf8")).toBe(renderCorpus());
});
