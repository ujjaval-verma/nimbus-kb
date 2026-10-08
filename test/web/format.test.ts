import { expect, it } from "vitest";
import { fmtContext, fmtPrice } from "../../src/web/format";

it("formats context windows as whole numbers", () => {
  expect(fmtContext(200_000)).toBe("200K");
  expect(fmtContext(1_000_000)).toBe("1M");
  expect(fmtContext(1_048_576)).toBe("1M");
  expect(fmtContext(1_050_000)).toBe("1M");
});

it("formats prices with two decimals", () => {
  expect([fmtPrice(2), fmtPrice(0.1), fmtPrice(0.03)]).toEqual(["$2.00", "$0.10", "$0.03"]);
});
