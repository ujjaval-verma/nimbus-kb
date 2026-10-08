import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSiteGate } from "../../src/server/site-gate";
import { SECURITY_HEADERS } from "../../src/server/security";

const PW = "s3cret:with:colons";
const basic = (raw: string) => `Basic ${btoa(raw)}`;
const req = (authorization?: string, path = "/") =>
  new Request(`https://nimbus.example${path}`, authorization === undefined ? {} : { headers: { authorization } });

describe("site gate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("no header: 401 with the challenge, no-store, the security headers and a plain body", async () => {
    const res = (await checkSiteGate(req(), PW))!;
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe('Basic realm="Nimbus KB", charset="UTF-8"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
    expect(await res.text()).toBe("Password required.");
  });

  it("gates every kind of path", async () => {
    for (const p of ["/", "/assets/app.js", "/api/models", "/foo"]) expect((await checkSiteGate(req(undefined, p), PW))!.status).toBe(401);
  });

  it("a wrong password is refused", async () => {
    expect((await checkSiteGate(req(basic("x:wrong")), PW))!.status).toBe(401);
    expect((await checkSiteGate(req(basic("x:")), PW))!.status).toBe(401);
  });

  it("the right password passes with any username, including an empty one", async () => {
    expect(await checkSiteGate(req(basic("someone:s3cret:with:colons")), PW)).toBeNull();
    expect(await checkSiteGate(req(basic(":s3cret:with:colons")), PW)).toBeNull();
  });

  it("a password containing a colon passes (split on the first colon only)", async () => {
    expect(await checkSiteGate(req(basic("u:a:b")), "a:b")).toBeNull();
  });

  it("accepts the scheme case-insensitively", async () => {
    expect(await checkSiteGate(req(`basic ${btoa("u:pw")}`), "pw")).toBeNull();
  });

  it("bad input fails closed: malformed base64, another scheme, no colon", async () => {
    expect((await checkSiteGate(req("Basic !!!not-base64!!!"), PW))!.status).toBe(401);
    expect((await checkSiteGate(req("Basic"), PW))!.status).toBe(401);
    expect((await checkSiteGate(req("Bearer abc"), PW))!.status).toBe(401);
    expect((await checkSiteGate(req(basic("nocolonhere")), PW))!.status).toBe(401);
    expect((await checkSiteGate(req(`Basic ${btoa("ÿþ")}`), PW))!.status).toBe(401);   // base64 of bytes that are not valid UTF-8
  });

  it("with no password set, every request passes and the warning is logged once", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { checkSiteGate: fresh } = await import("../../src/server/site-gate");
    for (const pw of [undefined, ""]) {
      expect(await fresh(req(), pw)).toBeNull();
      expect(await fresh(req(basic("x:y")), pw)).toBeNull();
    }
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0][0]).toBe("[gate] SITE_PASSWORD is not set; the site is open to everyone");
  });
});
