// Shared-password gate for the live site (HTTP Basic Auth). Pure TypeScript with no Workers imports, so Node tests run all of it.
// The username is ignored; only the password is checked. Unset or empty password means no gate.
import { timingSafeEqual } from "hono/utils/buffer";
import { SECURITY_HEADERS } from "./security";

let warned = false;   // log the open-site warning at most once per isolate

function deny(): Response {
  return new Response("Password required.", {
    status: 401,
    headers: {
      ...SECURITY_HEADERS,
      "WWW-Authenticate": 'Basic realm="Nimbus KB", charset="UTF-8"',
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=UTF-8",
    },
  });
}

// The password from a Basic header, or null for anything malformed (never throws).
function passwordFrom(header: string | null): string | null {
  const m = /^basic +(\S+)$/i.exec(header ?? "");
  if (!m) return null;
  let decoded: string;
  try {
    const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");   // first colon: the password itself may contain ":"
  return colon < 0 ? null : decoded.slice(colon + 1);
}

// Returns null when the request may proceed, or the 401 response to send.
export async function checkSiteGate(request: Request, password: string | undefined): Promise<Response | null> {
  if (!password) {
    if (!warned) { warned = true; console.error("[gate] SITE_PASSWORD is not set; the site is open to everyone"); }
    return null;
  }
  const given = passwordFrom(request.headers.get("authorization"));
  if (given === null || !(await timingSafeEqual(given, password))) return deny();
  return null;
}
