import { readFileSync } from "node:fs";
import { type Fixture, type FixtureProvider, fixturePath } from "../../scripts/fixtures";

export function loadFixture(provider: FixtureProvider, name: string): Fixture {
  return JSON.parse(readFileSync(fixturePath(provider, name), "utf8")) as Fixture;
}

export interface SeenRequest { url: string; body: Record<string, unknown>; signal: AbortSignal | null }

// Serves the fixture's recorded response for every call and records what the SDK sent. Never touches the network.
export function replayFetch(fx: Fixture, seen: SeenRequest[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const isReq = typeof input === "object" && "url" in input && !(input instanceof URL);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const raw = init?.body ?? (isReq ? await (input as Request).clone().text() : undefined);
    seen.push({ url, body: typeof raw === "string" && raw ? JSON.parse(raw) : {}, signal: init?.signal ?? (isReq ? (input as Request).signal : null) });
    return new Response(fx.response.body, { status: fx.response.status, headers: { "content-type": fx.response.contentType } });
  }) as typeof fetch;
}

// The parsed JSON of every `data:` line of a recorded SSE body (Anthropic uses \n, Gemini \r\n).
export function sseData(body: string): unknown[] {
  return body.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5).trim()));
}
