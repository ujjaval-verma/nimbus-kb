import { expect, it } from "vitest";
import { fmtContext } from "../../src/web/format";

it("formats context windows as whole numbers", () => {
  expect(fmtContext(200_000)).toBe("200K");
  expect(fmtContext(1_000_000)).toBe("1M");
  expect(fmtContext(1_048_576)).toBe("1M");
  expect(fmtContext(1_050_000)).toBe("1M");
});
