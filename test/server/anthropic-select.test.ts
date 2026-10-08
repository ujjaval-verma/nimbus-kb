import { describe, expect, it } from "vitest";
import { selectAnthropic } from "../../src/server/anthropic-select";

describe("selectAnthropic", () => {
  it("uses the subscription by default, even with a key in the environment", () => {
    expect(selectAnthropic({})).toBe("subscription");
    expect(selectAnthropic({ ANTHROPIC_API_KEY: "k" })).toBe("subscription");
  });
  it("uses the API only on explicit opt-in with a key", () => {
    expect(selectAnthropic({ ANTHROPIC_DEV_API: "1", ANTHROPIC_API_KEY: "k" })).toBe("api");
    expect(selectAnthropic({ ANTHROPIC_DEV_API: "1" })).toBe("subscription");
    expect(selectAnthropic({ ANTHROPIC_DEV_API: "0", ANTHROPIC_API_KEY: "k" })).toBe("subscription");
  });
  it("is off when the subscription is disabled and the API is not opted into", () => {
    expect(selectAnthropic({ CLAUDE_SUBSCRIPTION: "0", ANTHROPIC_API_KEY: "k" })).toBe("none");
    expect(selectAnthropic({ CLAUDE_SUBSCRIPTION: "0", ANTHROPIC_DEV_API: "1", ANTHROPIC_API_KEY: "k" })).toBe("api");
  });
});
