import { expect, it } from "vitest";
import { linkCitations } from "../../src/web/citations";

it("turns refs into anchor links and leaves other brackets alone (Review Focus 4)", () => {
  expect(linkCitations("A [vault.md#pricing]. B [relay.md#support-sla, vault.md#pricing]. The [Pro] tier, [x](https://a.md#b)."))
    .toBe("A [vault › pricing](#src-vault.md#pricing). B [relay › support-sla](#src-relay.md#support-sla) [vault › pricing](#src-vault.md#pricing). The [Pro] tier, [x](https://a.md#b).");
});
