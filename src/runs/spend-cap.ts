/**
 * The GLOBAL model-spend cap — the operator's budget backstop from
 * [ADR-0007](../../docs/adr/0007-access-and-cost-model.md).
 *
 * TWO CONTROLS, TWO DIFFERENT JOBS. The per-account lifetime allowance
 * (`./allowance.ts`) DISTRIBUTES the resource: it bounds what one account can
 * draw, so a single enthusiastic user cannot close the tool for everyone else.
 * It says nothing about the total, because a public tool gains accounts. This
 * module bounds the BILL: what every account together may spend in one billing
 * period. ADR-0007 rejects each of them alone and keeps both.
 *
 * ── WHAT IT MEASURES: billable live runs, not dollars ──
 *
 * Nothing in this application can read what the model provider has actually
 * billed. A dollar figure would have to be reconstructed from a hand-typed price
 * per token, and a number nobody measured is exactly what this project refuses
 * to ship. A run is the unit we can genuinely count, and under the LOCKED judge
 * (one pinned model, one pinned temperature, one frozen rubric, one judge call
 * per run) a run's judge cost is bounded and close to constant. So the count is
 * a PROXY for spend, and this comment is where it says so rather than a screen
 * claiming a currency figure it did not measure.
 *
 * The meter counts PERSISTED runs, which is a lower bound on runs started: a run
 * in flight has not been written yet. The cap can therefore be overshot by
 * roughly the number of runs running concurrently at the moment it trips. That
 * is a bounded, deliberate imprecision — this is a budget guard, not an
 * accountant — and it errs by a handful of runs, never by an unbounded amount.
 *
 * ── OVER WHAT WINDOW: the current UTC calendar month ──
 *
 * The liability being protected is a monthly invoice, so the budget refills when
 * the bill does. A LIFETIME global cap would permanently close a public tool the
 * first time it was popular, which defeats the point of being public. A ROLLING
 * window would be off-phase with the invoice, so the same configured number
 * would mean a different fraction of the bill every month. UTC rather than the
 * host zone, so the reset instant does not move with a deploy region.
 *
 * ── FAIL CLOSED ──
 *
 * If the meter cannot be read, this refuses. A spend control whose own state is
 * unknown is not a permissive spend control, it is an open tap, and the case
 * where the meter is unreadable is precisely the case where something is already
 * wrong. Every path that cannot produce a trustworthy count refuses: no meter, a
 * rejected read, and any answer that is not a finite non-negative integer.
 *
 * REFUSAL IS A VALUE, NOT A CRASH — the same house pattern as
 * `checkLiveRunAllowance` and `verifyRunToken`. The trip point pauses live runs
 * gracefully down the seam `resolveLiveDetector()` already established for an
 * unconfigured judge: a bounded, expected state the UI states plainly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLiveRunSpendCap } from '@/config/env';

type Env = Record<string, string | undefined>;

/** Why the cap refused. For OUR logs; the wire code is always the same one. */
export type LiveRunSpendCapReason = 'CAP_REACHED' | 'METER_UNREADABLE';

/**
 * The refusal a paused live run meets. Its `message` is user-facing copy.
 *
 * It deliberately quotes NO numeral. The operator's budget is internal
 * accounting: unlike the per-account allowance it is not something the visitor
 * can act on, and stating it tells a stranger how much traffic it takes to close
 * the tool. The figures stay on the error object for our own logs.
 */
export class LiveRunSpendCapError extends Error {
  /** Stable discriminator for callers that map outcomes to UI states. */
  readonly code = 'SPEND_CAP_REACHED' as const;
  readonly reason: LiveRunSpendCapReason;
  readonly cap: number;
  /** Runs counted in the period, or `null` when the meter could not be read. */
  readonly used: number | null;

  constructor(reason: LiveRunSpendCapReason, cap: number, used: number | null) {
    super(
      reason === 'CAP_REACHED'
        ? 'Live runs are paused: the operator budget for this billing period has been reached. ' +
            'Sample playback stays open to everyone.'
        : 'Live runs are paused: the spend control could not be read, so we cannot confirm this ' +
            'run is inside the budget. Sample playback stays open to everyone.',
    );
    this.name = 'LiveRunSpendCapError';
    this.reason = reason;
    this.cap = cap;
    this.used = used;
  }
}

/**
 * What the cap needs from persistence: how many runs the WHOLE deployment has
 * recorded since an instant.
 *
 * It takes no user id, and that absence is the design. A per-account count read
 * under a global name would report one user's runs as the deployment's spend,
 * which is why this is its own port rather than a method on the RLS-scoped
 * `RunRepository`.
 */
export interface SpendMeter {
  countRunsSince(since: Date): Promise<number>;
}

/** The first instant of the UTC calendar month containing `now`. */
export function currentBillingPeriodStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface LiveRunSpendCapQuery {
  /** The global meter. `null`/absent is an unreadable meter, and refuses. */
  readonly meter?: SpendMeter | null;
  /** Injected clock, so the billing period is deterministic in tests. */
  readonly now?: Date;
  /** Environment to read the cap from. Defaults to `process.env`. */
  readonly env?: Env;
}

/** A cleared run: the budget, what the period has spent, what is left. */
export interface LiveRunSpendCapCleared {
  readonly allowed: true;
  readonly cap: number;
  readonly used: number;
  readonly remaining: number;
  readonly periodStart: Date;
}

/** A paused run: the same accounting where it is known, plus the typed error. */
export interface LiveRunSpendCapRefused {
  readonly allowed: false;
  readonly cap: number;
  readonly used: number | null;
  readonly remaining: 0;
  readonly periodStart: Date;
  readonly error: LiveRunSpendCapError;
}

export type LiveRunSpendCapDecision = LiveRunSpendCapCleared | LiveRunSpendCapRefused;

/** A count we are willing to act on: a real, whole, non-negative number of runs. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Decide whether the deployment may pay for another live run this period.
 *
 * Never throws for either refusal case; both are decisions, returned. A cap of
 * zero refuses without reading the meter at all, because the operator's off
 * switch should not cost a database scan to honour.
 */
export async function checkGlobalSpendCap(
  query: LiveRunSpendCapQuery = {},
): Promise<LiveRunSpendCapDecision> {
  const cap = getLiveRunSpendCap(query.env ?? process.env);
  const periodStart = currentBillingPeriodStart(query.now ?? new Date());

  const refuse = (reason: LiveRunSpendCapReason, used: number | null): LiveRunSpendCapRefused => ({
    allowed: false,
    cap,
    used,
    remaining: 0,
    periodStart,
    error: new LiveRunSpendCapError(reason, cap, used),
  });

  if (cap === 0) return refuse('CAP_REACHED', null);
  if (!query.meter) return refuse('METER_UNREADABLE', null);

  let used: number;
  try {
    used = await query.meter.countRunsSince(periodStart);
  } catch {
    // The underlying failure is deliberately not carried into the message: a
    // connection string or a provider error can name hosts and credentials, and
    // this sentence is printed to a stranger.
    return refuse('METER_UNREADABLE', null);
  }

  if (!isCount(used)) return refuse('METER_UNREADABLE', null);
  if (used >= cap) return refuse('CAP_REACHED', used);

  return { allowed: true, cap, used, remaining: cap - used, periodStart };
}

/**
 * The real meter: the rows in `public.runs` created in the period that stand
 * for a JUDGE CALL, which is every row except a discarded run's.
 *
 * It must be built from a client that BYPASSES RLS (the service-role admin
 * client), because the whole point is a total across accounts and an RLS-scoped
 * session can only ever see its own. `head: true` asks Postgres for the count
 * and no rows.
 *
 * ── A DISCARDED RUN IS NOT SPEND ──
 *
 * The count is a proxy for model spend, and it is a fair one only while a row
 * means "the judge was asked once". A discarded run
 * ([ADR-0013](../../docs/adr/0013-a-discarded-run-is-stored-unjudged.md)) is
 * stored in the same table so the per-account allowance still counts it, but it
 * made no judge call, so counting it here would charge the operator's budget
 * for money nobody spent. It is taken out: every row in the period, minus the
 * rows marked discarded.
 *
 * Two counts and a subtraction, rather than one count with a "not discarded"
 * filter, on purpose. `run->>discarded` is NULL on every judged row, and in SQL
 * `NOT (NULL = 'true')` is NULL, not true, so the obvious negated filter would
 * match no judged row at all and report a spotless month. The positive filter
 * has no such trap, and it is the same `eq` on a `run->>key` path the run
 * repository already uses against the real project.
 *
 * The two reads are not one transaction, so a discard landing between them can
 * put the second count one ahead of the first. The result is floored at zero
 * rather than reported negative, which `checkGlobalSpendCap` would (rightly)
 * refuse as unreadable.
 *
 * A query error THROWS rather than answering zero, on EITHER read. Answering
 * zero would report "nothing spent this period" for a failed read, which is the
 * open tap `checkGlobalSpendCap` fails closed against; throwing lets it refuse.
 * A failed read of the discarded count is not treated as "none were discarded"
 * either: the meter's own state is then unknown, and unknown refuses.
 *
 * An UNKNOWN count throws for the same reason. An empty table answers 0, so a
 * `null` count is not "no rows", it is "no number" — and a HEAD request against
 * a table PostgREST cannot see returns exactly that, with `error: null`. This
 * meter used to read that as zero, which meant an unreadable meter reported a
 * spotless month.
 */
export function createRunTableSpendMeter(client: SupabaseClient): SpendMeter {
  const known = (
    label: string,
    answer: { count: number | null; error: { message: string } | null },
  ): number => {
    if (answer.error) throw new Error(`spend meter read failed: ${answer.error.message}`);
    if (answer.count === null || answer.count === undefined) {
      throw new Error(`spend meter read failed: the ${label} count came back unknown.`);
    }
    return answer.count;
  };

  return {
    async countRunsSince(since: Date): Promise<number> {
      const from = since.toISOString();
      const total = known(
        'run',
        await client
          .from('runs')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', from),
      );
      const discarded = known(
        'discarded',
        await client
          .from('runs')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', from)
          .eq('run->>discarded', 'true'),
      );
      return Math.max(0, total - discarded);
    },
  };
}
