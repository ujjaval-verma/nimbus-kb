import { describe, expect, it } from "vitest";
import { SECTIONS } from "../../src/kb";
import { searchSections } from "../../src/kb/keyword";

const ids = (q: string, n = 5) => searchSections(q, SECTIONS, n).map((s) => s.id);

describe("searchSections", () => {
  it("bridges single sign-on wording to SAML/OIDC sections (E5)", () => {
    expect(ids("does it do single sign-on?")).toEqual(expect.arrayContaining(["security-overview.md#identity"]));
  });
  it("boosts the named product", () => {
    expect(ids("Vault pricing")[0]).toBe("vault.md#pricing");
  });
  it("finds release notes by version", () => {
    expect(ids("what is new in v4.2 of Relay")[0]).toBe("relay-release-notes.md#4-2");
  });
  it("finds 403 troubleshooting", () => {
    expect(ids("client gets a 403 on the API")).toEqual(expect.arrayContaining(["relay.md#troubleshooting", "pulse.md#troubleshooting"]));
  });
  it("returns nothing when only product names or filler words match", () => {
    expect(ids("Does Relay support GraphQL?")).toEqual([]);
    expect(ids("tell me about nimbus")).toEqual([]);
  });
  it("stems so encryption matches encrypted/encrypt", () => {
    const r = ids("What encryption does Vault use?");
    expect(r.some((id) => id.startsWith("vault.md#") || id.startsWith("security-overview.md#"))).toBe(true);
  });
  it("returns [] for empty, punctuation-only and stopword-only queries", () => {
    expect(ids("")).toEqual([]);
    expect(ids("?!... --")).toEqual([]);
    expect(ids("what is the")).toEqual([]);
  });
});
