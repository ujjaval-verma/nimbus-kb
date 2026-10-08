import { afterEach, describe, expect, it, vi } from "vitest";

// The Worker module re-exports a Durable Object class that extends the runtime-only "cloudflare:workers" module.
vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
const { default: worker } = await import("../../src/server/worker");
const { httpsRedirect } = await import("../../src/server/https-redirect");

const PW = "pw-for-tests";
const auth = { authorization: `Basic ${btoa(`demo:${PW}`)}` };
const assetsFetch = vi.fn(async () => new Response("asset"));
const envWith = (extra: Record<string, unknown> = {}) => ({ ASSETS: { fetch: assetsFetch }, SITE_PASSWORD: PW, ...extra }) as unknown as Env;
const call = (url: string, env: Env, headers: Record<string, string> = {}) =>
  worker.fetch!(new Request(url, { headers }) as never, env, { waitUntil() {}, passThroughOnException() {} } as never) as Promise<Response>;

describe("worker routing", () => {
  afterEach(() => assetsFetch.mockClear());

  it("without credentials every path is a 401 and the assets are never fetched", async () => {
    for (const p of ["/", "/assets/x.js", "/api/models"]) {
      const res = await call(`https://nimbus.example${p}`, envWith());
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toContain("Basic");
    }
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("with credentials, pages and assets go to ASSETS and /api/* reaches the app", async () => {
    expect((await call("https://nimbus.example/", envWith(), auth)).status).toBe(200);
    expect((await call("https://nimbus.example/foo", envWith(), auth)).status).toBe(200);
    expect(assetsFetch).toHaveBeenCalledTimes(2);
    assetsFetch.mockClear();
    expect((await call("https://nimbus.example/api/health", envWith(), auth)).status).toBe(200);
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("http is redirected to https (308) before the gate, so no challenge is sent; loopback hosts are exempt", async () => {
    const res = await call("http://nimbus.example/foo?a=1", envWith());
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://nimbus.example/foo?a=1");
    expect(res.headers.get("WWW-Authenticate")).toBeNull();
    for (const host of ["localhost:8787", "127.0.0.1:8787", "[::1]:8787"]) {
      expect((await call(`http://${host}/`, envWith())).status).toBe(401);   // not redirected: the gate answers
    }
    expect(httpsRedirect(new Request("https://nimbus.example/"))).toBeNull();
  });

  it("with a provider key but no QUOTA, BURST or QUOTA_SALT, no model is registered", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call("https://nimbus.example/api/models", envWith({ ANTHROPIC_API_KEY: "fake-key-for-test", GEMINI_API_KEY: "fake-key-for-test" }), auth);
    const body = await res.json() as { models: { available: boolean }[] };
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models.every((m) => !m.available)).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
