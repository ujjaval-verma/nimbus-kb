import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createQuotaGate, ipKey, MemoryQuotaStore, parseQuotaLimits, PUBLIC_MAX_OUTPUT_TOKENS, QUOTA_LIMITS, QuotaLedger, type SqlLike, SqlQuotaStore, utcDay } from "../../src/server/quota";

const N = QUOTA_LIMITS.perVisitor;   // 10 by default
const DAY1 = "2026-10-07";
const DAY2 = "2026-10-08";

describe("ipKey and utcDay", () => {
  it("keeps a whole IPv4 address", () => {
    expect(ipKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipKey(" 203.0.113.7 ")).toBe("203.0.113.7");
    expect(ipKey("::ffff:203.0.113.7")).toBe("203.0.113.7");   // IPv4-mapped IPv6 is the same visitor
  });
  it("groups IPv6 by /64, whatever the notation", () => {
    const a = ipKey("2001:db8:abcd:12:1::5");
    expect(a).toBe("2001:0db8:abcd:0012::/64");
    expect(ipKey("2001:0DB8:ABCD:0012:ffff:ffff:ffff:ffff")).toBe(a);
    expect(ipKey("2001:db8:abcd:13::1")).not.toBe(a);
    expect(ipKey("::1")).toBe("0000:0000:0000:0000::/64");
  });
  it("returns null for missing or malformed input, so callers fail closed", () => {
    for (const bad of [undefined, null, "", "  ", "not-an-ip", "256.1.1.1", "1.2.3", "2001:db8::1::2", "2001:db8:zz::1"]) expect(ipKey(bad)).toBeNull();
  });
  it("days are UTC dates", () => {
    expect(utcDay(new Date("2026-10-07T23:59:59Z"))).toBe(DAY1);
    expect(utcDay(new Date("2026-10-08T00:00:00Z"))).toBe(DAY2);
  });
});

describe("QuotaLedger", () => {
  const make = (limits: { perVisitor: number; siteWide: number } = QUOTA_LIMITS) => {
    const store = new MemoryQuotaStore();
    return { store, l: new QuotaLedger(store, limits) };
  };

  it("allows the per-visitor limit (default 10) per day, then refuses with reason visitor", () => {
    const { l } = make();
    for (let i = 1; i <= N; i++) expect(l.reserve("v1", DAY1)).toMatchObject({ ok: true, visitorUsed: i });
    expect(l.reserve("v1", DAY1)).toMatchObject({ ok: false, reason: "visitor", visitorUsed: N });
    expect(l.reserve("v2", DAY1)).toMatchObject({ ok: true, visitorUsed: 1, siteUsed: N + 1 });
  });

  it("enforces the site-wide cap across visitors", () => {
    const { l } = make({ perVisitor: 5, siteWide: 3 });
    for (const v of ["a", "b", "c"]) expect(l.reserve(v, DAY1).ok).toBe(true);
    expect(l.reserve("d", DAY1)).toMatchObject({ ok: false, reason: "site" });
    expect(l.peek("a", DAY1)).toMatchObject({ ok: false, reason: "site", visitorUsed: 1 });
  });

  it("release gives one answer back and never goes below zero", () => {
    const { l } = make();
    l.reserve("v", DAY1);
    l.release("v", DAY1);
    l.release("v", DAY1);
    expect(l.peek("v", DAY1)).toMatchObject({ ok: true, visitorUsed: 0, siteUsed: 0 });
  });

  it("a release with nothing to give back writes nothing (a late release after the object was evicted)", () => {
    const { l, store } = make();
    l.release("v", DAY1);
    expect(store.rows.size).toBe(0);
    l.reserve("w", DAY1);
    l.release("v", DAY1);   // v has nothing reserved: v's row is not created, the site count is untouched
    expect([...store.rows.entries()]).toEqual([[`${DAY1}|w`, 1], [`${DAY1}|site`, 1]]);
  });

  it("resets at the UTC day boundary and deletes the old day's rows", () => {
    const { l, store } = make();
    for (let i = 0; i < N; i++) l.reserve("v", DAY1);
    expect(l.reserve("v", DAY1).ok).toBe(false);
    expect(l.reserve("v", DAY2)).toMatchObject({ ok: true, visitorUsed: 1, siteUsed: 1 });
    expect([...store.rows.keys()].every((k) => k.startsWith(DAY2))).toBe(true);
    l.release("v", DAY1);   // a late release for yesterday changes nothing
    expect([...store.rows.keys()].every((k) => k.startsWith(DAY2))).toBe(true);
  });
});

describe("SqlQuotaStore (the Durable Object's storage, run here on node:sqlite)", () => {
  const sqlite = (): SqlLike => {
    const db = new DatabaseSync(":memory:");
    return { exec: (q, ...b) => ({ toArray: () => {
      const st = db.prepare(q);
      if (/^\s*select/i.test(q)) return st.all(...b) as Record<string, unknown>[];
      st.run(...b);
      return [];
    } }) };
  };
  it("counts, upserts and drops old days with the same SQL the Durable Object runs", () => {
    const store = new SqlQuotaStore(sqlite());
    const l = new QuotaLedger(store);
    for (let i = 0; i < N; i++) l.reserve("v", DAY1);
    expect(l.reserve("v", DAY1)).toMatchObject({ ok: false, reason: "visitor" });
    expect(store.get(DAY1, "v")).toBe(N);
    expect(l.reserve("v", DAY2).ok).toBe(true);
    expect(store.get(DAY1, "v")).toBe(0);   // deleted at rollover
  });
});

describe("createQuotaGate", () => {
  const make = (o: { now?: () => Date; burstOk?: boolean } = {}) => {
    const store = new MemoryQuotaStore();
    const burstKeys: string[] = [];
    const g = createQuotaGate({ ledger: new QuotaLedger(store), salt: "test-salt",
      burst: { limit: async ({ key }) => { burstKeys.push(key); return { success: o.burstOk ?? true }; } },
      now: o.now ?? (() => new Date("2026-10-07T12:00:00Z")) });
    return { g, store, burstKeys };
  };
  const visitorRow = (store: MemoryQuotaStore) => [...store.rows.keys()].find((k) => !k.endsWith("|site"))!;

  it("stores only a salted daily hash, never the address", async () => {
    const { g, store } = make();
    await g.reserve("203.0.113.7");
    const keys = [...store.rows.keys()].join(" ");
    expect(keys).not.toContain("203.0.113.7");
    expect(visitorRow(store).split("|")[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("resets after midnight UTC, and the same visitor gets a new hash each day", async () => {
    let now = new Date("2026-10-07T23:59:59Z");
    const { g, store } = make({ now: () => now });
    for (let i = 0; i < N; i++) await g.reserve("203.0.113.7");
    expect(await g.peek("203.0.113.7")).toEqual({ limit: N, remaining: 0, exhausted: "visitor" });
    const day1Hash = visitorRow(store).split("|")[1];
    now = new Date("2026-10-08T00:00:01Z");
    expect(await g.peek("203.0.113.7")).toEqual({ limit: N, remaining: N, exhausted: null });
    await g.reserve("203.0.113.7");
    expect(visitorRow(store).split("|")[1]).not.toBe(day1Hash);
  });

  it("reports nothing left once the site-wide cap is reached, whatever the visitor has used", async () => {
    const store = new MemoryQuotaStore();
    const g = createQuotaGate({ ledger: new QuotaLedger(store, { perVisitor: 5, siteWide: 1 }), limits: { perVisitor: 5, siteWide: 1 }, salt: "s",
      burst: { limit: async () => ({ success: true }) }, now: () => new Date("2026-10-07T12:00:00Z") });
    await g.reserve("198.51.100.1");
    expect(await g.peek("198.51.100.2")).toEqual({ limit: 5, remaining: 0, exhausted: "site" });
  });

  it("reports nothing left when a reservation takes the last site-wide answer", async () => {
    const g = createQuotaGate({ ledger: new QuotaLedger(new MemoryQuotaStore(), { perVisitor: 5, siteWide: 1 }), limits: { perVisitor: 5, siteWide: 1 },
      salt: "s", burst: { limit: async () => ({ success: true }) }, now: () => new Date("2026-10-07T12:00:00Z") });
    expect(await g.reserve("198.51.100.1")).toMatchObject({ ok: true, remaining: 0 });
  });

  it("reports what is left and releases at most once", async () => {
    const { g } = make();
    const r = await g.reserve("203.0.113.7");
    expect(r).toMatchObject({ ok: true, limit: N, remaining: N - 1, exhausted: null });
    await r.release();
    await r.release();
    expect(await g.peek("203.0.113.7")).toMatchObject({ remaining: N });
  });

  it("keys the burst limiter by the visitor key", async () => {
    const { g, burstKeys } = make({ burstOk: false });
    expect(await g.allowBurst("203.0.113.7")).toBe(false);
    expect(burstKeys).toEqual(["203.0.113.7"]);
  });

  it("parseQuotaLimits: defaults (10 and 300), deployer overrides, and invalid values fail closed", () => {
    expect(QUOTA_LIMITS.perVisitor).toBe(10);
    expect(parseQuotaLimits({})).toEqual({ ok: true, limits: { perVisitor: 10, siteWide: 300 } });
    expect(parseQuotaLimits({ QUOTA_PER_VISITOR_PER_DAY: "3", QUOTA_SITE_PER_DAY: " 50 " })).toEqual({ ok: true, limits: { perVisitor: 3, siteWide: 50 } });
    for (const bad of ["0", "-1", "abc", "1.5", "", "1e3", "Infinity"]) {
      const r = parseQuotaLimits({ QUOTA_PER_VISITOR_PER_DAY: bad });
      expect(r.ok, `"${bad}" must be rejected`).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/QUOTA_PER_VISITOR_PER_DAY/);
    }
    expect(parseQuotaLimits({ QUOTA_SITE_PER_DAY: "unlimited" }).ok).toBe(false);
  });

  it("a configured limit is what the gate reports (the UI shows this number, not a hardcoded one)", async () => {
    const g = createQuotaGate({ ledger: new QuotaLedger(new MemoryQuotaStore(), { perVisitor: 3, siteWide: 50 }),
      limits: { perVisitor: 3, siteWide: 50 }, salt: "s", burst: { limit: async () => ({ success: true }) } });
    expect(await g.peek("203.0.113.7")).toEqual({ limit: 3, remaining: 3, exhausted: null });
  });

  it("the public reply cap fits the longest recorded answer with margin (a reply cut at the cap can lose its citations)", () => {
    expect(PUBLIC_MAX_OUTPUT_TOKENS).toBe(3_000);
    const outs = [...readFileSync("evals/results/latest.md", "utf8").matchAll(/ (\d+) out /g)].map((m) => Number(m[1]));
    expect(outs.length).toBeGreaterThan(10);
    expect(PUBLIC_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(Math.max(...outs) * 1.25);   // longest today: 2,172 (Q1)
  });

  it("the committed wrangler.json vars equal the code defaults", () => {
    const cfg = JSON.parse(readFileSync("wrangler.json", "utf8")) as { vars: Record<string, string> };
    expect(cfg.vars).toMatchObject({ QUOTA_PER_VISITOR_PER_DAY: String(QUOTA_LIMITS.perVisitor), QUOTA_SITE_PER_DAY: String(QUOTA_LIMITS.siteWide) });
  });

  it("the burst limit matches the ratelimit binding in wrangler.json", () => {
    const cfg = JSON.parse(readFileSync("wrangler.json", "utf8")) as { ratelimits: { name: string; simple: { limit: number; period: number } }[] };
    expect(cfg.ratelimits.find((r) => r.name === "BURST")!.simple).toEqual(QUOTA_LIMITS.burst);
  });
});
