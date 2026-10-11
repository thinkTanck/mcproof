import type { SupabaseClient } from '@supabase/supabase-js';
import {
  checkGlobalSpendCap,
  createRunTableSpendMeter,
  currentBillingPeriodStart,
  LiveRunSpendCapError,
} from '@/runs/spend-cap';

const CAP_5 = { LIVE_RUN_SPEND_CAP: '5' };
const NOW = new Date('2026-08-05T12:00:00.000Z');

/** A meter that answers a fixed number and records what period it was asked for. */
function meter(count: number) {
  const calls: Date[] = [];
  return {
    calls,
    countRunsSince: async (since: Date) => {
      calls.push(since);
      return count;
    },
  };
}

describe('currentBillingPeriodStart — the window the cap is measured over', () => {
  /**
   * A UTC calendar month, because the liability the cap protects is a MONTHLY
   * invoice. A cap whose window is off-phase with the bill it exists to bound
   * would have to be re-reasoned every month.
   */
  it('is the first instant of the current UTC calendar month', () => {
    expect(currentBillingPeriodStart(NOW).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('rolls over at the month boundary, so the budget refills with the bill', () => {
    const lastMoment = new Date('2026-08-31T23:59:59.999Z');
    const firstMoment = new Date('2026-09-01T00:00:00.000Z');

    expect(currentBillingPeriodStart(lastMoment).toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(currentBillingPeriodStart(firstMoment).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  /** UTC, never the server's local zone: the reset instant must not move with a deploy region. */
  it('uses UTC rather than the host time zone', () => {
    const januaryFirstUtc = new Date('2026-01-01T00:30:00.000Z');
    expect(currentBillingPeriodStart(januaryFirstUtc).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });
});

describe('checkGlobalSpendCap — the operator budget backstop (ADR-0007)', () => {
  it('clears a run while the period is under the cap, and reports the accounting', async () => {
    const m = meter(2);
    const decision = await checkGlobalSpendCap({ meter: m, now: NOW, env: CAP_5 });

    expect(decision.allowed).toBe(true);
    expect(decision).toMatchObject({ cap: 5, used: 2, remaining: 3 });
  });

  it('clears the LAST run of the period (the boundary is used < cap)', async () => {
    const decision = await checkGlobalSpendCap({ meter: meter(4), now: NOW, env: CAP_5 });

    expect(decision.allowed).toBe(true);
    expect(decision).toMatchObject({ used: 4, remaining: 1 });
  });

  it('refuses once the period has reached the cap, with a TYPED error rather than a throw', async () => {
    const decision = await checkGlobalSpendCap({ meter: meter(5), now: NOW, env: CAP_5 });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.error).toBeInstanceOf(LiveRunSpendCapError);
    expect(decision.error.name).toBe('LiveRunSpendCapError');
    expect(decision.error.code).toBe('SPEND_CAP_REACHED');
    expect(decision.error.reason).toBe('CAP_REACHED');
    expect(decision.error.cap).toBe(5);
    expect(decision.error.used).toBe(5);
  });

  it('asks the meter for the CURRENT billing period, not for all time', async () => {
    const m = meter(0);
    await checkGlobalSpendCap({ meter: m, now: NOW, env: CAP_5 });

    expect(m.calls[0]?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('reads the cap from config, so the budget moves with the environment', async () => {
    const decision = await checkGlobalSpendCap({
      meter: meter(5),
      now: NOW,
      env: { LIVE_RUN_SPEND_CAP: '9' },
    });

    expect(decision.allowed).toBe(true);
    expect(decision).toMatchObject({ cap: 9, remaining: 4 });
  });

  /** 0 is the off switch, and it must not cost a database scan to honour. */
  it('refuses every run when the cap is zero, without consulting the meter at all', async () => {
    const m = meter(0);
    const decision = await checkGlobalSpendCap({
      meter: m,
      now: NOW,
      env: { LIVE_RUN_SPEND_CAP: '0' },
    });

    expect(decision.allowed).toBe(false);
    expect(m.calls).toHaveLength(0);
  });

  it('never reports negative remaining when a period overshoots the cap', async () => {
    const decision = await checkGlobalSpendCap({ meter: meter(99), now: NOW, env: CAP_5 });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.remaining).toBe(0);
  });

  it('defaults `now` to the wall clock when none is injected', async () => {
    const m = meter(0);
    await checkGlobalSpendCap({ meter: m, env: CAP_5 });

    const asked = m.calls[0];
    expect(asked).toBeInstanceOf(Date);
    expect(asked?.toISOString()).toBe(currentBillingPeriodStart(new Date()).toISOString());
  });
});

/**
 * FAIL CLOSED. A spend control whose own state cannot be read is not a spend
 * control that happens to be permissive, it is an open tap. Every way the meter
 * can fail to produce a trustworthy number must refuse the run.
 */
describe('checkGlobalSpendCap — an unreadable meter refuses', () => {
  it('refuses when the meter rejects (the store is unreachable)', async () => {
    const decision = await checkGlobalSpendCap({
      meter: {
        countRunsSince: async () => {
          throw new Error('connection reset');
        },
      },
      now: NOW,
      env: CAP_5,
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.error.code).toBe('SPEND_CAP_REACHED');
    expect(decision.error.reason).toBe('METER_UNREADABLE');
    expect(decision.error.used).toBeNull();
  });

  it('refuses when there is no meter to read at all', async () => {
    const decision = await checkGlobalSpendCap({ meter: null, now: NOW, env: CAP_5 });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.error.reason).toBe('METER_UNREADABLE');
  });

  /**
   * A number that is not a count is not an answer. Trusting any of these would
   * turn a broken adapter into an unbounded budget.
   */
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 2.5])(
    'refuses when the meter answers %s, which is not a count',
    async (value) => {
      const decision = await checkGlobalSpendCap({
        meter: { countRunsSince: async () => value },
        now: NOW,
        env: CAP_5,
      });

      expect(decision.allowed).toBe(false);
      if (decision.allowed) return expect.unreachable('expected a refusal');
      expect(decision.error.reason).toBe('METER_UNREADABLE');
    },
  );

  it('does not leak the underlying failure into the sentence a user reads', async () => {
    const decision = await checkGlobalSpendCap({
      meter: {
        countRunsSince: async () => {
          throw new Error('postgres://user:hunter2@db.internal timed out');
        },
      },
      now: NOW,
      env: CAP_5,
    });

    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.error.message).not.toContain('hunter2');
    expect(decision.error.message).not.toContain('postgres');
  });
});

describe('LiveRunSpendCapError — copy the UI can state plainly', () => {
  const reached = new LiveRunSpendCapError('CAP_REACHED', 500, 500);
  const unreadable = new LiveRunSpendCapError('METER_UNREADABLE', 500, null);

  it('says live runs are paused rather than that something failed', () => {
    expect(reached.message.toLowerCase()).toContain('paused');
    expect(unreadable.message.toLowerCase()).toContain('paused');
  });

  it('points at the path that still works instead of dead-ending', () => {
    expect(reached.message.toLowerCase()).toContain('sample');
    expect(unreadable.message.toLowerCase()).toContain('sample');
  });

  /**
   * The operator's budget is deliberately NOT quoted to the visitor. It is
   * internal accounting, it tells a stranger how much traffic it takes to close
   * the tool, and unlike the per-account allowance it is not a number the user
   * can act on. It stays on the typed error for our own logs.
   */
  it('quotes no operator budget numeral in the user-facing sentence', () => {
    expect(reached.message).not.toMatch(/\d/);
    expect(unreadable.message).not.toMatch(/\d/);
    expect(reached.cap).toBe(500);
  });

  /** UI copy rule: no em dashes. */
  it('carries no em dash', () => {
    expect(reached.message).not.toContain('—');
    expect(unreadable.message).not.toContain('—');
  });

  it('is a real Error, so it survives being thrown and caught', () => {
    expect(reached).toBeInstanceOf(Error);
    expect(() => {
      throw reached;
    }).toThrow(LiveRunSpendCapError);
  });
});

/**
 * The meter is GLOBAL by construction: its only argument is a period start, so
 * there is nowhere to pass a user id and no way for it to quietly report one
 * account's runs under a global name.
 */
describe('createRunTableSpendMeter — the global count over public.runs', () => {
  function fakeClient(result: { count: number | null; error: { message: string } | null }) {
    const seen: {
      table?: string;
      columns?: string;
      options?: unknown;
      column?: string;
      value?: string;
    } = {};
    const client = {
      from(table: string) {
        seen.table = table;
        return {
          select(columns: string, options: unknown) {
            seen.columns = columns;
            seen.options = options;
            return {
              gte(column: string, value: string) {
                seen.column = column;
                seen.value = value;
                // The meter reads twice: every row in the period, then the
                // rows marked discarded, which it subtracts. The second read
                // adds one `eq` and answers "none" here, so these tests keep
                // pinning the total. The subtraction has its own tests in
                // tests/unit/data/discarded-run.test.ts.
                return Object.assign(Promise.resolve(result), {
                  eq: () => Promise.resolve({ count: 0, error: null }),
                });
              },
            };
          },
        };
      },
    };
    return { client: client as unknown as SupabaseClient, seen };
  }

  it('counts every run in the period that was not discarded, across all accounts', async () => {
    const { client, seen } = fakeClient({ count: 17, error: null });
    const since = new Date('2026-08-01T00:00:00.000Z');

    expect(await createRunTableSpendMeter(client).countRunsSince(since)).toBe(17);
    expect(seen.table).toBe('runs');
    expect(seen.options).toMatchObject({ count: 'exact', head: true });
    expect(seen.column).toBe('created_at');
    expect(seen.value).toBe(since.toISOString());
  });

  /**
   * MEASURED, NOT ASSUMED. An empty table does NOT answer `null`: PostgREST
   * returns `count: 0` with status 200, which was checked against the real
   * project (`npm run verify:durable-stores`, section 0). A `null` count means
   * the number is UNKNOWN, and the case that produced it there was a HEAD
   * request against a missing table, which supabase-js reports as status 204
   * with `error: null` — a failed read wearing the shape of an empty one.
   *
   * This test used to assert the opposite, and that assertion was the hole: a
   * meter that reads "nothing spent this period" off an unreadable table is the
   * open tap `checkGlobalSpendCap` exists to close.
   */
  it('refuses to call an UNKNOWN count zero, because that reads as no spend', async () => {
    const { client } = fakeClient({ count: null, error: null });
    await expect(createRunTableSpendMeter(client).countRunsSince(new Date(0))).rejects.toThrow(
      /count/i,
    );
  });

  /**
   * The meter THROWS on a query error rather than answering zero. Answering zero
   * would report "no spend this period" for a failed read, which is the exact
   * open tap `checkGlobalSpendCap` fails closed against.
   */
  it('throws on a query error instead of reporting no spend', async () => {
    const { client } = fakeClient({ count: null, error: { message: 'permission denied' } });
    await expect(createRunTableSpendMeter(client).countRunsSince(new Date(0))).rejects.toThrow();
  });
});
