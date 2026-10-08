import { expect, it } from "vitest";
import { demoteHeadings } from "../../evals/format";

it("demotes headings inside a model answer by two levels, capped at h6", () => {
  expect(demoteHeadings("## Nimbus Relay\n\ntext\n# Top\n##### Deep")).toBe("#### Nimbus Relay\n\ntext\n### Top\n###### Deep");
});
it("leaves non-heading lines, hashtags and fenced code alone", () => {
  const md = "#hashtag\nC# is a language\n```\n## not a heading\n```\n## Real";
  expect(demoteHeadings(md)).toBe("#hashtag\nC# is a language\n```\n## not a heading\n```\n#### Real");
});
