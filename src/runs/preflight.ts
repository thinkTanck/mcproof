/**
 * PREFLIGHT — the one gate a live run passes before it costs anything.
 *
 * [ADR-0007](../../docs/adr/0007-access-and-cost-model.md) decided two cost
 * controls, and at first each existed on its own: the per-account lifetime
 * allowance was built before anything called it, and the global spend cap was
 * designed before it was built. Two gates a caller has to remember to call in
 * the right order is a gate that eventually gets called in the wrong one, so
 * they are composed here and a live-run entry point calls exactly this.
 *
 * ── ORDER, AND WHY A REFUSED RUN COSTS NOTHING ──
 *
 * Cheapest first, and both before anything is spent:
 *
 *   1. CONFIG (free). Both numbers are read and validated before any I/O, so a
 *      misconfigured cap surfaces as a `ConfigError` rather than being masked by
 *      whichever gate happened to answer first.
 *   2. THE PER-ACCOUNT ALLOWANCE (one account's rows). Served by the
 *      `(user_id, created_at desc)` index and scoped to the caller.
 *   3. THE GLOBAL SPEND CAP (every account's rows in the period, read with a
 *      privileged client). The expensive one, and it is never reached when the
 *      cheap one has already refused.
 *
 * The whole gate runs BEFORE the judge is resolved and before the agent is
 * invited to connect, so a refused run makes no model call and issues no run
 * token. That ordering is the point: a cost control that runs after the spend is
 * an audit log.
 *
 * ── FAIL CLOSED ──
 *
 * If the spend cap's own state cannot be read, this refuses. See
 * `./spend-cap.ts` for the reasoning; the short version is that an unreadable
 * spend control is an open tap, not a permissive one. A per-account PERSISTENCE
 * FAILURE is different and is deliberately allowed to propagate: "the run store
 * is unreachable" is not the same answer as "you are out of runs", the refusal
 * vocabulary has no honest code for it, and a rejected promise still fails
 * closed because no run starts either way.
 *
 * ── INTEGRATION POINT ──
 *
 * This composes the gates and exposes them. Its caller is the live-run host:
 * `liveRunDeps()` (`src/app/api/mcp/host.ts`) passes it in as `preflight`, and
 * `./live-run.ts` calls it after authentication and before anything is spent,
 * once in `start()` before the per-run token is issued and again in `finish()`
 * before the judge:
 *
 *   preflight: async ({ userId, now }) =>
 *     checkLiveRunPreflight({ userId, ...(now === undefined ? {} : { now }) }),
 *
 * A refusal, or a thrown error, stops the run there (`gate()` in
 * `./live-run.ts` fails closed).
 *
 * `accountCreatedAt` is optional because a run cannot predate its owner's
 * account: omitting it counts from the epoch, which yields the same total and
 * can only ever over-count. Auth and RLS are untouched.
 */
import { getLiveRunAllowance, getLiveRunSpendCap, getSupabaseConfig } from '@/config/env';
import { checkLiveRunAllowance, type RunCounter } from './allowance';
import { checkGlobalSpendCap, createRunTableSpendMeter, type SpendMeter } from './spend-cap';

type Env = Record<string, string | undefined>;

/**
 * A refusal the UI can state without further translation. `code` is the stable
 * discriminator; `message` is already the sentence, derived from configuration
 * rather than written next to it.
 */
export type LiveRunRefusal = { code: 'ALLOWANCE_EXHAUSTED' | 'SPEND_CAP_REACHED'; message: string };

/** Cleared, or refused with a reason. There is no third answer. */
export type PreflightDecision = { allowed: true } | { allowed: false; refusal: LiveRunRefusal };

export interface LiveRunPreflightInput {
  /** Supabase auth user id — the account the allowance belongs to. */
  readonly userId: string;
  /** Injected clock, so the billing period is deterministic in tests. */
  readonly now?: Date;
  /** The account's creation instant (`user.created_at`). Optional; see above. */
  readonly accountCreatedAt?: Date | string | null;
  /** Environment to read both numbers from. Defaults to `process.env`. */
  readonly env?: Env;
  /** Test/caller seam: the RLS-scoped run counter. Resolved when absent. */
  readonly repository?: RunCounter;
  /** Test/caller seam: the global spend meter. Resolved when absent. */
  readonly meter?: SpendMeter | null;
}

/**
 * The global meter, from the SERVICE-ROLE client. RLS scopes an ordinary session
 * to its own rows, so a session-bound client cannot produce a deployment total;
 * it would silently report the caller's own runs as global spend.
 *
 * The import is dynamic because `@/lib/supabase/server` is server-only (it pulls
 * `next/headers`), and this module should stay importable by anything that only
 * wants the types.
 *
 * `null` when Supabase is not configured, which fails closed one layer up. That
 * is the honest answer rather than an inconvenience: with no shared run history
 * there is nothing to meter, so we cannot show a run is inside the budget.
 */
async function resolveSpendMeter(env: Env): Promise<SpendMeter | null> {
  if (!getSupabaseConfig(env)) return null;
  const { createAdminSupabase } = await import('@/lib/supabase/server');
  const client = createAdminSupabase();
  return client ? createRunTableSpendMeter(client) : null;
}

/** The caller's own RLS-scoped repository, the same one the rest of the app uses. */
async function resolveRunCounter(): Promise<RunCounter> {
  const { getRunRepository } = await import('@/data/run-repository.factory');
  return getRunRepository();
}

/**
 * Decide whether this account may start a live run right now.
 *
 * Returns a decision; it does not throw for either refusal. A `ConfigError` from
 * an invalid cap or allowance, and a persistence failure on the per-account
 * count, both propagate on purpose (see the fail-closed note above).
 */
export async function checkLiveRunPreflight(
  input: LiveRunPreflightInput,
): Promise<PreflightDecision> {
  const env = input.env ?? process.env;

  // 1. Config first, because it is free and because a broken spend control must
  //    not be discoverable only on the runs that happen to reach the cap.
  getLiveRunAllowance(env);
  getLiveRunSpendCap(env);

  // 2. The cheap gate: one account's lifetime count.
  const repository = input.repository ?? (await resolveRunCounter());
  const allowance = await checkLiveRunAllowance({
    repository,
    userId: input.userId,
    accountCreatedAt: input.accountCreatedAt,
    env,
  });
  if (!allowance.allowed) {
    return {
      allowed: false,
      refusal: { code: allowance.error.code, message: allowance.error.message },
    };
  }

  // 3. The expensive gate, reached only by a run the account may actually have.
  const meter = input.meter !== undefined ? input.meter : await resolveSpendMeter(env);
  const spend = await checkGlobalSpendCap({ meter, ...(input.now ? { now: input.now } : {}), env });
  if (!spend.allowed) {
    return { allowed: false, refusal: { code: spend.error.code, message: spend.error.message } };
  }

  return { allowed: true };
}
