// Worker only. One global instance (idFromName("quota")) holds every count. A Durable Object handles one request at
// a time and QuotaLedger never awaits between check and increment, so each reserve() is atomic.
import { DurableObject } from "cloudflare:workers";
import { type LedgerResult, parseQuotaLimits, QuotaLedger, type QuotaVars, SqlQuotaStore } from "./quota";

export class QuotaCounter extends DurableObject<Env> {
  private ledger: QuotaLedger | null;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Same vars as the Worker reads, so both use the same limits. Invalid: every call throws, and the app fails closed.
    const parsed = parseQuotaLimits(env as unknown as QuotaVars);
    this.ledger = parsed.ok ? new QuotaLedger(new SqlQuotaStore(ctx.storage.sql), parsed.limits) : null;
  }
  private get l(): QuotaLedger {
    if (!this.ledger) throw new Error("quota limits are invalid; see the Worker log");
    return this.ledger;
  }
  peek(visitor: string, day: string): LedgerResult { return this.l.peek(visitor, day); }
  reserve(visitor: string, day: string): LedgerResult { return this.l.reserve(visitor, day); }
  release(visitor: string, day: string): void { this.l.release(visitor, day); }
}
