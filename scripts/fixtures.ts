import { join } from "node:path";

export type FixtureProvider = "anthropic" | "gemini";

export interface Fixture {
  provider: FixtureProvider;
  name: string;
  synthetic: boolean;   // true: hand-written to imitate a response too costly or impractical to provoke (429, 5xx, ...)
  recordedOn: string;   // YYYY-MM-DD; for synthetic fixtures, the day it was written
  note: string;         // what the exchange is; synthetic ones start "Synthetic." and say what they imitate
  // Request headers (where keys live) and the request body (the whole system prompt) are never stored.
  request: { method: string; url: string; model: string; promptVersion: string; question: string };
  response: { status: number; contentType: string; body: string };
}

// Key-shaped strings: Anthropic, Google, OpenAI. A test fails if any fixture matches one.
export const KEY_PATTERNS: RegExp[] = [/sk-ant-[A-Za-z0-9_-]{10,}/, /AIza[0-9A-Za-z_-]{35}/, /sk-[A-Za-z0-9]{20,}/];
// Credential-carrying headers (as a header line or a JSON key) and query parameters. Error text that merely
// mentions a header, like Anthropic's "invalid x-api-key", is fine.
export const AUTH_HEADER_PATTERNS: RegExp[] = [
  /"(x-api-key|x-goog-api-key|authorization)"\s*:/i,
  /^(x-api-key|x-goog-api-key|authorization)\s*:/im,
  /[?&]key=/i,
];

export function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("REDACTED");
  for (const re of KEY_PATTERNS) out = out.replace(new RegExp(re.source, "g"), "REDACTED");
  return out.replace(/([?&])key=[^&"\s]*/gi, "$1redacted");
}

export const fixturePath = (provider: FixtureProvider, name: string) => join("test", "fixtures", provider, `${name}.json`);
