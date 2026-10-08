import type { Product, Section } from "./sections";

const STOP = new Set(("a an and are as at be by can do does for from has have how i in is it its me my of on or our " +
  "please should tell that the their them there they this to us we what when where which who why will with you your " +
  "about any some support supports supported nimbus nimbusstack product products").split(" "));
const PRODUCTS: Record<string, Product> = { relay: "relay", vault: "vault", pulse: "pulse", ledger: "ledger" };
const SYNONYMS: string[][] = [
  ["sso", "saml", "federated", "sign-in", "signin", "login", "oidc", "openid", "identity"],
  ["price", "pricing", "cost", "tier", "tiers", "plan", "seat"],
  ["sla", "response", "priority", "p1", "p2", "urgent"],
  ["403", "forbidden", "permission", "scope", "denied"],
  ["429", "rate", "throttle", "throttled"],
  ["release", "releases", "new", "feature", "features", "changelog", "version"],
  ["integrate", "integration", "integrations", "connector"],
];

function normalise(text: string): string {
  return text.toLowerCase()
    .replace(/single[\s-]sign[\s-]on/g, " sso ")
    .replace(/priority\s*([1-4])/g, " p$1 ")
    .replace(/sign[\s-]in/g, " sign-in ");
}
export function tokenize(text: string): string[] {
  return normalise(text).split(/[^a-z0-9.-]+/).map((t) => t.replace(/^[.-]+|[.-]+$/g, "").replace(/^v(\d)/, "$1")).filter(Boolean);
}

export function searchSections(query: string, sections: Section[], limit = 5): Section[] {
  const qTokens = tokenize(query);
  const named = new Set(qTokens.map((t) => PRODUCTS[t]).filter(Boolean));
  const content = qTokens.filter((t) => !STOP.has(t) && !PRODUCTS[t]);
  if (content.length === 0) return [];

  const weights = new Map<string, number>();
  for (const t of content) {
    weights.set(t, 1);
    for (const group of SYNONYMS) if (group.includes(t)) for (const s of group) if (!weights.has(s)) weights.set(s, 0.5);
  }

  const docs = sections.map((s) => tokenize(`${s.headingPath} ${s.text}`));
  const avgLen = docs.reduce((n, d) => n + d.length, 0) / docs.length;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const k1 = 1.2, b = 0.75, N = docs.length;

  const scored = sections.map((s, i) => {
    const tf = new Map<string, number>();
    for (const t of docs[i]) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const [t, w] of weights) {
      const f = tf.get(t); if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += w * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * docs[i].length) / avgLen)));
    }
    if (s.version && content.includes(s.version)) score += 5;
    if (named.size && named.has(s.product)) score *= 2;
    else if (named.size && s.product !== "company") score *= 0.5;
    return { s, score };
  });
  return scored.filter((x) => x.score > 0.5).sort((a, b2) => b2.score - a.score).slice(0, limit).map((x) => x.s);
}
