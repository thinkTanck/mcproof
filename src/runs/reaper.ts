/**
 * THE REAPER — what finishes a run whose owner closed the tab.
 *
 * `END RUN AND JUDGE` on `/connect` was the only path that finished a run, so a
 * user who walked away left three things behind: a row in the open-run registry,
 * an endpoint their agent could keep calling until the token died, and — the one
 * that actually costs somebody something — no verdict at all for inference they
 * had already paid for. This is the job that closes all three.
 *
 * See [ADR-0012](../../docs/adr/0012-abandoned-runs-are-completed-not-discarded.md)
 * for the decision and its costs. The four things worth knowing here:
 *
 * ── WHAT COUNTS AS STALE: THE WINDOW, NOT A GUESS AT IDLENESS ──
 *
 * A run is stale when it is still OPEN and its whole window has passed. That
 * window is already written on the row as `expiresAt`: the per-run token's
 * wall-clock death, plus `LIVE_RUN_SESSION_GRACE_MS` of grace after it. So this
 * module invents no clock of its own and has no TTL knob.
 *
 * It deliberately does NOT measure idle time since the last request, although
 * `lastSeenAt` exists. Two reasons, and the second is the real one. First, that
 * value lives in a `Map` inside whichever instance served the request
 * (`src/app/api/mcp/host.ts`), so a job running anywhere else cannot read it.
 * Second, idleness would only ever be a GUESS at abandonment, and past the token
 * expiry there is nothing to guess: the credential is dead, `verifyRunToken`
 * refuses every further connection, and the run is provably incapable of
 * recording another step. A long, productive, briefly idle run is never at risk
 * here, because a run whose token is still alive is never stale.
 *
 * ── JUDGE OR CLOSE: DECIDED BY WHETHER THE AGENT DID ANYTHING ──
 *
 * Judging costs the operator a real judge call and spends one of the account's
 * lifetime free runs, on a run nobody asked to have judged. Closing without
 * judging throws away work the user already paid inference for. Neither is right
 * for both cases, so the evidence decides:
 *
 *   - The trace contains at least one `tool_call` -> the agent turned up and did
 *     something. JUDGE it, through the ordinary `finish()`, and the user gets the
 *     verdict and the fix report they paid for.
 *   - It contains none -> nothing happened, there is nothing to be right or wrong
 *     about, and asking the judge would spend money and an allowance on an empty
 *     answer. CLOSE it: claim it, revoke the token, store nothing.
 *
 * ── IT GOES THROUGH THE SAME GATES, BECAUSE IT IS THE SAME FUNCTION ──
 *
 * The judging path calls `LiveRunHost.finish()` — not a copy of it. So the
 * preflight gate runs before the judge exactly as it does for a user clicking the
 * button, an allowance or spend-cap refusal stops the run, a gate that throws is
 * `GATE_UNAVAILABLE`, and an unconfigured judge is `DETECTION_UNAVAILABLE`. All
 * of them fail CLOSED: the run ends unjudged and nothing is spent. A background
 * job that reached the judge around the cost controls would be a spend control
 * with a hole in it.
 *
 * ── TWO INSTANCES MUST NOT BOTH FINISH ONE RUN ──
 *
 * `finish()` and `abandon()` both CLAIM the run through
 * `LiveRunSessionStore.finish`, which grants it exactly once. A second reaper
 * therefore meets `RUN_ALREADY_FINISHED`, which is counted as `contended` and is
 * not an error: it is a run somebody else got to first.
 *
 * ── A DISCARDED RUN IS NEVER REAPED ──
 *
 * A run its owner discarded
 * ([ADR-0013](../../docs/adr/0013-a-discarded-run-is-stored-unjudged.md)) was
 * claimed through that same grant, so it is not open: `findStale` does not list
 * it, the re-read below sees it finished, and a pass that raced the discard is
 * refused `RUN_DISCARDED` by `finish()` and counts the run `contended`. There is
 * no path from here to the judge for it, which matters because it usually DID
 * record a tool call, the very thing this pass would otherwise judge.
 *
 * ── THE SWEEP RUNS LAST, AND ONLY OVER SETTLED RUNS ──
 *
 * Deleting the row deletes the recorded steps with it, so the sweep happens after
 * the judging, never before. And if any run in the pass THREW, the sweep is
 * skipped entirely (`swept` is `null`): a throw leaves that run's state unknown,
 * a run that failed before its claim is still open and will be retried next pass,
 * and deleting it would destroy an unjudged trace to save a table row. A returned
 * REFUSAL is different — the run was claimed and settled, permanently unjudged —
 * so it does not block the sweep.
 */
import type { Logger } from '@/lib/logger';
import type { AbandonedLiveRun, LiveRunDecision, LiveRunOutcome } from '@/runs/live-run';
import { DEFAULT_STALE_RUN_LIMIT, type LiveRunSessionStore } from '@/runs/live-run-store';

/** How many stale runs one pass will try to settle. */
export const DEFAULT_REAP_LIMIT = DEFAULT_STALE_RUN_LIMIT;

/** What the reaper needs from the registry: find them, read one, drain the rest. */
export type ReapableSessions = Pick<LiveRunSessionStore, 'findStale' | 'find' | 'sweepExpired'>;

/** What it needs from the pipeline: the two ways a run can end. */
export interface ReapableHost {
  finish(input: { runId: string; userId: string }): Promise<LiveRunDecision<LiveRunOutcome>>;
  abandon(input: { runId: string; userId: string }): Promise<LiveRunDecision<AbandonedLiveRun>>;
}

export interface ReapAbandonedRunsInput {
  readonly sessions: ReapableSessions;
  readonly host: ReapableHost;
  /** Injected clock. Nothing here sleeps or reads the wall clock implicitly. */
  readonly now?: () => Date;
  /** How many stale runs this pass will try to settle. */
  readonly limit?: number;
  readonly logger?: Logger;
}

/**
 * What one pass did. Counts only — no run ids, no payloads, nothing secret — so
 * the whole thing is safe to log and safe to return over the wire.
 */
export interface ReapReport {
  /** Stale open runs this pass looked at. */
  readonly examined: number;
  /** Judged through the full pipeline, result stored, report generated. */
  readonly judged: number;
  /** Closed without a judge call, because the agent recorded no tool call. */
  readonly closed: number;
  /** Already claimed by somebody else. Expected, not an error. */
  readonly contended: number;
  /** Settled by a typed refusal (a gate, or an unavailable judge). Failed closed. */
  readonly refused: number;
  /** Threw. State unknown, retried next pass, and it blocks the sweep. */
  readonly failed: number;
  /** Rows deleted afterwards, or `null` when the sweep was skipped. */
  readonly swept: number | null;
}

/**
 * The refusals that mean "somebody else already has this run". `RUN_DISCARDED`
 * is one of them: the owner claimed the run with a discard between this pass
 * reading the row and asking for it, which is a run somebody else got to first
 * and not a gate failing closed.
 */
const CONTENDED = new Set(['RUN_ALREADY_FINISHED', 'RUN_NOT_FOUND', 'RUN_DISCARDED']);

/**
 * Settle every run whose window has passed, then drain the rows.
 *
 * Never throws for a single bad run: one unreachable row must not stop the pass
 * from finishing the others. A failure in `findStale` itself DOES propagate,
 * because a pass that cannot read the registry has not examined anything and
 * should say so rather than report a tidy zero.
 */
export async function reapAbandonedRuns(input: ReapAbandonedRunsInput): Promise<ReapReport> {
  const { sessions, host, logger } = input;
  const at = (input.now ?? (() => new Date()))();
  const limit = input.limit ?? DEFAULT_REAP_LIMIT;

  const stale = await sessions.findStale(at, limit);
  let judged = 0;
  let closed = 0;
  let contended = 0;
  let refused = 0;
  let failed = 0;

  for (const run of stale) {
    try {
      const record = await sessions.find(run.runId);
      // Re-read rather than trusting the list: between the query and here another
      // instance may have finished the run, and the row is the authority.
      if (record === null || record.finishedAt !== null) {
        contended += 1;
        continue;
      }

      // The agent's own steps are the only evidence that anything happened. The
      // principal instruction and the inferred completion are ours, not its.
      const worked = record.events.some((event) => event.type === 'tool_call');
      const decision = worked
        ? await host.finish({ runId: run.runId, userId: run.userId })
        : await host.abandon({ runId: run.runId, userId: run.userId });

      if (decision.ok) {
        if (worked) judged += 1;
        else closed += 1;
      } else if (CONTENDED.has(decision.error.code)) {
        contended += 1;
      } else {
        refused += 1;
        logger?.info('abandoned run settled without a verdict', { code: decision.error.code });
      }
    } catch {
      // The run's state is now unknown, so it is left alone and retried next pass.
      failed += 1;
      logger?.error('abandoned run could not be settled', { runId: run.runId });
    }
  }

  // Only over runs whose fate is known. See the header.
  const swept = failed > 0 ? null : await sessions.sweepExpired(at);

  const report: ReapReport = {
    examined: stale.length,
    judged,
    closed,
    contended,
    refused,
    failed,
    swept,
  };
  if (stale.length > 0 || (swept ?? 0) > 0) logger?.info('abandoned runs reaped', { ...report });
  return report;
}
