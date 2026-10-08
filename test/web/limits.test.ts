import { expect, it } from "vitest";
import { LIMITS } from "../../src/server/app";
import { MAX_QUESTION_CHARS } from "../../src/web/limits";

it("the client's question limit matches the server's", () => {
  expect(MAX_QUESTION_CHARS).toBe(LIMITS.maxQuestionChars);
});
