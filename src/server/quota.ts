// Public quota for the live site. Pure TypeScript with no Workers imports, so Node tests run all of it.
// The Durable Object in quota-do.ts is a thin wrapper around QuotaLedger + SqlQuotaStore.

export const PUBLIC_HISTORY_TOKENS = 20_000;     // public history budget: UTF-8 bytes / 3 plus 4 per message (fitPublic), so at most 60,000 bytes
export const PUBLIC_MAX_MESSAGES = 40;          // history messages per request on the public site (20 turns)
export const PUBLIC_MAX_OUTPUT_TOKENS = 3_000;   // reply cap per request; the longest eval answer was 2,172 output tokens
// Every public-quota default lives here. wrangler.json mirrors them: "vars" (QUOTA_PER_VISITOR_PER_DAY, QUOTA_SITE_PER_DAY,
// which deployers may change) and "ratelimits" (the burst limit). Tests keep the committed values equal to these.
export const QUOTA_LIMITS = {
  perVisitor: 25,                      // model answers per visitor per UTC day (people behind one shared IP share these)
  siteWide: 300,                       // model answers per UTC day for the whole site
  burst: { limit: 3, period: 10 },     // requests per visitor per 10 seconds
} as const;

export type ExhaustedReason = "visitor" | "site";
export interface LedgerResult { ok: boolean; reason: ExhaustedReason | null; visitorUsed: number; siteUsed: number }
export interface Ledger {
  peek(visitor: string, day: string): LedgerResult | Promise<LedgerResult>;
  reserve(visitor: string, day: string): LedgerResult | Promise<LedgerResult>;
  release(visitor: string, day: string): void | Promise<void>;
}
export interface QuotaStore { get(day: string, key: string): number; set(day: string, key: string, n: number): void; deleteBefore(day: string): void }

export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

export type QuotaVars = { QUOTA_PER_VISITOR_PER_DAY?: string; QUOTA_SITE_PER_DAY?: string };

// A missing var means the default. Anything else must be a positive whole number; an invalid value is an error the
// caller fails closed on (no model), never "unlimited".
export function parseQuotaLimits(vars: QuotaVars):
  { ok: true; limits: { perVisitor: number; siteWide: number } } | { ok: false; error: string } {
  const read = (raw: string | undefined, fallback: number): number | null =>
    raw === undefined ? fallback : /^[1-9]\d{0,6}$/.test(raw.trim()) ? Number(raw.trim()) : null;
  const perVisitor = read(vars.QUOTA_PER_VISITOR_PER_DAY, QUOTA_LIMITS.perVisitor);
  const siteWide = read(vars.QUOTA_SITE_PER_DAY, QUOTA_LIMITS.siteWide);
  if (perVisitor === null || siteWide === null) {
    return { ok: false, error: `QUOTA_PER_VISITOR_PER_DAY and QUOTA_SITE_PER_DAY must be positive whole numbers (got ${JSON.stringify(vars.QUOTA_PER_VISITOR_PER_DAY)} and ${JSON.stringify(vars.QUOTA_SITE_PER_DAY)})` };
  }
  return { ok: true, limits: { perVisitor, siteWide } };
}

function expandIPv6(ip: string): string[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parts = (s: string) => (s === "" ? [] : s.split(":"));
  const head = parts(halves[0]);
  const tail = halves.length === 2 ? parts(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  return groups.every((g) => /^[0-9a-f]{1,4}$/.test(g)) ? groups.map((g) => g.padStart(4, "0")) : null;
}

// IPv4: the whole address. IPv6: the /64 prefix, because one home or VM usually gets a whole /64.
export function ipKey(ip: string | null | undefined): string | null {
  const v = ip?.trim().toLowerCase();
  if (!v) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  const v4 = mapped ? mapped[1] : v;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return v4.split(".").every((o) => Number(o) <= 255) ? v4 : null;
  if (!v.includes(":")) return null;
  const groups = expandIPv6(v);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : null;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SITE = "site";   // visitor keys are 64 hex characters, so they never collide with this

// Check-and-increment with no await in between: inside a Durable Object (one request at a time) it is atomic.
export class QuotaLedger implements Ledger {
  private cleanedFor = "";
  constructor(private store: QuotaStore, private limits: { perVisitor: number; siteWide: number } = QUOTA_LIMITS) {}

  private roll(day: string): void {
    if (day > this.cleanedFor) { this.store.deleteBefore(day); this.cleanedFor = day; }
  }
  peek(visitor: string, day: string): LedgerResult {
    this.roll(day);
    const visitorUsed = this.store.get(day, visitor);
    const siteUsed = this.store.get(day, SITE);
    const reason: ExhaustedReason | null = visitorUsed >= this.limits.perVisitor ? "visitor" : siteUsed >= this.limits.siteWide ? "site" : null;
    return { ok: reason === null, reason, visitorUsed, siteUsed };
  }
  reserve(visitor: string, day: string): LedgerResult {
    const r = this.peek(visitor, day);
    if (!r.ok) return r;
    this.store.set(day, visitor, r.visitorUsed + 1);
    this.store.set(day, SITE, r.siteUsed + 1);
    return { ...r, visitorUsed: r.visitorUsed + 1, siteUsed: r.siteUsed + 1 };
  }
  release(visitor: string, day: string): void {
    if (day < this.cleanedFor) return;   // that day is already gone
    this.roll(day);
    // Nothing to give back (e.g. a late release after the object restarted): write nothing.
    if (this.store.get(day, visitor) <= 0) return;
    for (const key of [visitor, SITE]) {
      const n = this.store.get(day, key);
      if (n > 0) this.store.set(day, key, n - 1);
    }
  }
}

export class MemoryQuotaStore implements QuotaStore {
  readonly rows = new Map<string, number>();
  get(day: string, key: string): number { return this.rows.get(`${day}|${key}`) ?? 0; }
  set(day: string, key: string, n: number): void { this.rows.set(`${day}|${key}`, n); }
  deleteBefore(day: string): void { for (const k of this.rows.keys()) if (k.slice(0, 10) < day) this.rows.delete(k); }
}

// The Durable Object's ctx.storage.sql has this shape; tests pass a node:sqlite adapter.
export interface SqlLike { exec(query: string, ...bindings: (string | number)[]): { toArray(): Record<string, unknown>[] } }

export class SqlQuotaStore implements QuotaStore {
  constructor(private sql: SqlLike) {
    sql.exec("CREATE TABLE IF NOT EXISTS quota (day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, key))").toArray();
  }
  get(day: string, key: string): number {
    return Number(this.sql.exec("SELECT n FROM quota WHERE day = ? AND key = ?", day, key).toArray()[0]?.n ?? 0);
  }
  set(day: string, key: string, n: number): void {
    this.sql.exec("INSERT INTO quota (day, key, n) VALUES (?, ?, ?) ON CONFLICT (day, key) DO UPDATE SET n = excluded.n", day, key, n).toArray();
  }
  deleteBefore(day: string): void {
    this.sql.exec("DELETE FROM quota WHERE day < ?", day).toArray();
  }
}

export interface QuotaView { limit: number; remaining: number; exhausted: ExhaustedReason | null }
export interface Reservation extends QuotaView { ok: boolean; release(): Promise<void> }
export interface BurstLimiter { limit(o: { key: string }): Promise<{ success: boolean }> }
export interface QuotaGate {
  allowBurst(ipKey: string): Promise<boolean>;
  peek(ipKey: string): Promise<QuotaView>;
  reserve(ipKey: string): Promise<Reservation>;
}

export function createQuotaGate(o: { ledger: Ledger; burst: BurstLimiter; salt: string;
  limits?: { perVisitor: number; siteWide: number }; now?: () => Date }): QuotaGate {
  const now = o.now ?? (() => new Date());
  const perVisitor = o.limits?.perVisitor ?? QUOTA_LIMITS.perVisitor;   // must match the ledger's limits
  const siteWide = o.limits?.siteWide ?? QUOTA_LIMITS.siteWide;
  // The daily salt (UTC date + secret) means a stored hash cannot be linked to the same visitor on another day.
  const visitor = (ip: string, day: string) => sha256Hex(`${day}:${o.salt}:${ip}`);
  const view = (r: LedgerResult): QuotaView =>
    ({ limit: perVisitor, remaining: r.reason === "site" || r.siteUsed >= siteWide ? 0 : Math.max(0, perVisitor - r.visitorUsed), exhausted: r.reason });
  return {
    async allowBurst(ip) { return (await o.burst.limit({ key: ip })).success; },
    async peek(ip) { const day = utcDay(now()); return view(await o.ledger.peek(await visitor(ip, day), day)); },
    async reserve(ip) {
      const day = utcDay(now());
      const v = await visitor(ip, day);
      const r = await o.ledger.reserve(v, day);
      let released = false;
      return { ...view(r), ok: r.ok, release: async () => {
        if (!r.ok || released) return;
        released = true;
        await o.ledger.release(v, day);   // the day captured at reserve time, even if midnight has passed
      } };
    },
  };
}
