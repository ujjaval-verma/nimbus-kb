// The Worker never serves the password prompt (or anything else) over plain HTTP: the shared password would travel in cleartext.
// Local development (`npm run dev:worker`, `wrangler dev`) runs over http on a loopback host and is exempt.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function httpsRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || LOOPBACK.has(url.hostname)) return null;
  url.protocol = "https:";
  return Response.redirect(url.toString(), 308);
}
