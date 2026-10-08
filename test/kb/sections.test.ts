import { describe, expect, it } from "vitest";
import { CORPUS } from "../../src/kb/corpus.gen";
import { parseSections } from "../../src/kb/sections";
import { getSection, SECTIONS } from "../../src/kb";

describe("parseSections", () => {
  it("creates one section per ## heading (32) plus non-empty overviews", () => {
    expect(SECTIONS.filter((s) => !s.id.endsWith("#overview"))).toHaveLength(32);
    expect(getSection("relay.md#overview")?.text).toContain("managed API gateway");
    expect(SECTIONS.some((s) => s.id === "relay-release-notes.md#overview")).toBe(false);
  });

  it("ids are unique", () => {
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
  });

  it("keeps tables intact inside their section", () => {
    const pricing = getSection("vault.md#pricing")!;
    expect(pricing.text).toContain("| Single sign-on | Password only | SAML 2.0 | SAML 2.0 |");
    expect(pricing.text).toContain("| Price | $12 | $35 | Custom |");
  });

  it("parses metadata for product docs", () => {
    const s = getSection("pulse.md#access-and-sign-in")!;
    expect(s).toMatchObject({ product: "pulse", docType: "product", docTitle: "Nimbus Pulse",
      headingPath: "Nimbus Pulse > Access and sign-in", docDate: "2026-08-22", version: null });
  });

  it("uses the heading date and version for release-note sections", () => {
    const s = getSection("vault-release-notes.md#3-1")!;
    expect(s).toMatchObject({ product: "vault", docType: "release-notes", docDate: "2026-04-14", version: "3.1" });
    expect(s.text).toContain("extended to the Pro tier");
  });

  it("classifies company-wide documents", () => {
    expect(getSection("security-overview.md#identity")).toMatchObject({ product: "company", docType: "company", docDate: "2026-01-15" });
    expect(getSection("support-policy.md#priority-definitions")?.product).toBe("company");
  });

  it("excludes the title and date lines from overview text", () => {
    const o = getSection("relay.md#overview")!;
    expect(o.text).not.toContain("# Nimbus Relay");
    expect(o.text).not.toContain("updated 2026-06-12");
  });

  it("is pure (same input, same output)", () => {
    expect(parseSections(CORPUS)).toEqual(SECTIONS);
  });
});
