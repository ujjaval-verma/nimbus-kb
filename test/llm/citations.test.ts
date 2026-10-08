import { expect, it } from "vitest";
import { extractCitations } from "../../src/llm/citations";

const ids = new Set(["vault.md#pricing", "relay.md#support-sla", "vault-release-notes.md#3-1"]);

it("extracts single and grouped refs in order, deduplicated", () => {
  const r = extractCitations("Pro has SAML [vault.md#pricing]. It changed [vault-release-notes.md#3-1, vault.md#pricing].", ids);
  expect(r).toEqual({ citedIds: ["vault.md#pricing", "vault-release-notes.md#3-1"], invalidRefCount: 0 });
});

it("counts unknown section ids as invalid", () => {
  expect(extractCitations("x [vault.md#nope] y [relay.md#support-sla]", ids))
    .toEqual({ citedIds: ["relay.md#support-sla"], invalidRefCount: 1 });
});

it("ignores markdown links and plain bracketed words (Review Focus 4)", () => {
  const r = extractCitations("The [Pro] tier, see [docs](https://example.com/a.md#b) and [vault.md#pricing].", ids);
  expect(r).toEqual({ citedIds: ["vault.md#pricing"], invalidRefCount: 0 });
});
