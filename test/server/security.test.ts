import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { CSP, SECURITY_HEADERS } from "../../src/server/security";

it("with allowedHosts, other Host headers are refused (DNS rebinding on the local server)", async () => {
  const app = createApp({ allowedHosts: ["127.0.0.1:8787"] });
  expect((await app.request("http://127.0.0.1:8787/api/health")).status).toBe(200);
  expect((await app.request("http://evil.example/api/health")).status).toBe(403);
  expect((await createApp({}).request("http://nimbus.ujjaval.ca/api/health")).status).toBe(200);   // Worker: no allowlist
});

it("API responses carry the security headers", async () => {
  const res = await createApp({}).request("/api/health");
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
});

it("the CSP blocks outside images, scripts, connections and framing", () => {
  expect(CSP).toContain("default-src 'self'");
  expect(CSP).toContain("img-src 'self' data:");
  expect(CSP).toContain("connect-src 'self'");
  expect(CSP).toContain("frame-ancestors 'none'");
  expect(CSP).not.toMatch(/script-src[^;]*unsafe-inline/);
});

it("public/_headers serves the same headers on static assets", () => {
  const file = readFileSync("public/_headers", "utf8");
  expect(file.startsWith("/*\n")).toBe(true);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(file).toContain(`  ${k}: ${v}\n`);
});

it("the 403 for a refused host also carries the security headers", async () => {
  const res = await createApp({ allowedHosts: ["127.0.0.1:8787"] }).request("http://evil.example/api/health");
  expect(res.status).toBe(403);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
});

it("a Host header that disagrees with an allowed URL host is refused", async () => {
  const app = createApp({ allowedHosts: ["127.0.0.1:8787"] });
  const res = await app.request("http://127.0.0.1:8787/api/health", { headers: { host: "evil.example" } });
  expect(res.status).toBe(403);
  const ok = await app.request("http://127.0.0.1:8787/api/health", { headers: { host: "127.0.0.1:8787" } });
  expect(ok.status).toBe(200);
});
