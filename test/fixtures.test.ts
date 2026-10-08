import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_HEADER_PATTERNS, type Fixture, KEY_PATTERNS } from "../scripts/fixtures";

const files = readdirSync("test/fixtures", { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".json")).map((f) => join("test/fixtures", f));

describe("API fixtures", () => {
  it("exist", () => { expect(files.length).toBeGreaterThan(0); });

  it.each(files)("%s holds no key, key-shaped string or auth header", (f) => {
    const text = readFileSync(f, "utf8");
    for (const re of KEY_PATTERNS) expect(re.test(text), `${f} matches ${re}`).toBe(false);
    for (const re of AUTH_HEADER_PATTERNS) expect(re.test(text), `${f} matches ${re}`).toBe(false);
    // If this shell has the live keys, they must not appear verbatim. The message names the file only, never the key.
    for (const k of [process.env.ANTHROPIC_API_KEY, process.env.GEMINI_API_KEY]) if (k) expect(text.includes(k), `${f} contains a live key`).toBe(false);
  });

  it.each(files)("%s is well formed, and a synthetic fixture says so", (f) => {
    const fx = JSON.parse(readFileSync(f, "utf8")) as Fixture;
    expect(fx.provider).toBe(f.split(/[\\/]/).at(-2));
    expect(typeof fx.synthetic).toBe("boolean");
    expect(Object.keys(fx.request).sort()).toEqual(["method", "model", "promptVersion", "question", "url"]);
    if (fx.synthetic) expect(fx.note).toMatch(/^Synthetic\./);
  });
});
