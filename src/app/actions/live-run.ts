'use server';

/**
 * THE RUN-LIFECYCLE ACTIONS: start a live run, watch it, end it or discard it.
 *
 * These calls are what `/connect` uses. They are the production caller of
 * `createLiveRunHost` on the control side, exactly as `/api/mcp/[runId]` is on
 * the agent side, and they add no policy of their own: the gate, the token, the
 * judge and persistence all belong to the pipeline.
 *
 * ── THE ACCOUNT IS READ, NEVER ACCEPTED ──
 *
 * Every action resolves the signed-in user on the server. There is no `userId`
 * parameter anywhere in this file, so a caller cannot start a run as somebody
 * else or ask about a run they do not own. A run belonging to another account and
 * a run that does not exist get the SAME refusal, so the id space cannot be
 * probed for which runs are real.
 *
 * ── BOTH GATES, AT BOTH ENDS ──
 *
 * `checkLiveRunPreflight` runs twice per run, and neither call is made here: the
 * pipeline calls it BEFORE it issues a token (a refused run mints nothing and
 * hosts nothing) and again BEFORE the judge (a cap that trips mid-run pauses
 * instead of spending). This layer wires the gate in and RELAYS its answer.
 * A gate that THROWS is a third case the pipeline names `GATE_UNAVAILABLE`, and
 * it fails closed like the rest: "we could not read your allowance" is a
 * different fact from "you are out of runs", and both stop the run.
 *
 * ── THE TICKET IS SHOWN ONCE ──
 *
 * `startLiveRun` returns the per-run token in full. That is the only moment it
 * exists in full anywhere: it is never logged, and storage holds a digest that
 * cannot produce it. A screen that loses it must start a new run.
 */
import type { Trace } from '@/contract';
import { getUser } from '@/lib/auth/user';
import type { LiveRunDecision, LiveRunError } from '@/runs/live-run';
import { getLiveRunHost } from '@/app/api/mcp/host';
import {
  INVALID_REQUEST_MESSAGE,
  LiveRunRefSchema,
  NOT_SIGNED_IN_MESSAGE,
  StartLiveRunRequestSchema,
  type LiveRunActionResult,
  type LiveRunDiscardView,
  type LiveRunPhase,
  type LiveRunReattachView,
  type LiveRunStatusView,
  type LiveRunSummaryView,
  type LiveRunTicketView,
} from '@/app/actions/live-run-contract';

/** The signed-in account id, or `null`. Live runs are gated on it. */
async function currentUserId(): Promise<string | null> {
  const user = await getUser();
  return user?.id ?? null;
}

const notSignedIn = <T>(): LiveRunActionResult<T> => ({
  ok: false,
  code: 'NOT_SIGNED_IN',
  message: NOT_SIGNED_IN_MESSAGE,
});

const invalidRequest = <T>(): LiveRunActionResult<T> => ({
  ok: false,
  code: 'INVALID_REQUEST',
  message: INVALID_REQUEST_MESSAGE,
});

/** A pipeline refusal, relayed with its own code and its own sentence. */
const relay = <T>(error: LiveRunError): LiveRunActionResult<T> => ({
  ok: false,
  code: error.code,
  message: error.message,
});

/** Count the steps the agent itself chose to take. */
function toolCalls(trace: Trace): number {
  return trace.steps.filter((step) => step.type === 'tool_call').length;
}

/**
 * Start a live run: gate, issue a per-run endpoint and token, host the MCP server
 * the agent connects to, and hand back the out-of-band goal.
 */
export async function startLiveRun(
  input: unknown,
): Promise<LiveRunActionResult<LiveRunTicketView>> {
  const userId = await currentUserId();
  if (userId === null) return notSignedIn();

  const parsed = StartLiveRunRequestSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();

  const decision: LiveRunDecision<LiveRunTicketView> = await getLiveRunHost().start({
    userId,
    category: parsed.data.category,
    ...(parsed.data.kind === undefined ? {} : { kind: parsed.data.kind }),
    ...(parsed.data.model === undefined ? {} : { model: parsed.data.model }),
  });
  if (!decision.ok) return relay(decision.error);
  return { ok: true, value: decision.value };
}

/**
 * Where the run has got to: whether the agent has turned up, how much it has
 * done, and whether the run has been finished. Safe to poll.
 *
 * EVERY FIELD COMES FROM THE DURABLE ROW. This action runs in a different
 * process from the one that serves the agent, so anything read from process
 * memory here is read from the wrong process. It used to take "connected" and
 * "last seen" from such a map, and a live run showed AWAITING AGENT and LAST
 * SEEN never beside a count of three tool calls.
 *
 * `connected` is derived from the two durable signs of a connection: the row
 * has a client name (written when `initialize` is served), or the trace holds a
 * tool call. `finished` is the row's own `finished_at`.
 *
 * `connectedAt` and `lastSeenAt` are reported as null. Nothing durable records
 * WHEN the agent connected or was last seen: that needs `connected_at` and
 * `last_seen_at` columns on `live_runs`, a migration deferred to v2. Null means
 * "not recorded", and the screen omits the reading rather than print "never".
 */
export async function getLiveRunStatus(
  input: unknown,
): Promise<LiveRunActionResult<LiveRunStatusView>> {
  const userId = await currentUserId();
  if (userId === null) return notSignedIn();

  const parsed = LiveRunRefSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  const { runId } = parsed.data;

  // Owner-scoped inside the pipeline: another account gets RUN_NOT_FOUND, which
  // is the same answer an id that never existed gets.
  const decision = await getLiveRunHost().getStatus({ runId, userId });
  if (!decision.ok) return relay(decision.error);

  const { trace, client, finishedAt, discarded } = decision.value;
  const calls = toolCalls(trace);
  const connected = client !== null || calls > 0;
  const phase: LiveRunPhase =
    finishedAt !== null ? 'finished' : connected ? 'connected' : 'waiting';

  return {
    ok: true,
    value: {
      runId,
      phase,
      connectedAt: null,
      lastSeenAt: null,
      steps: trace.steps.length,
      toolCalls: calls,
      finishedAt,
      // A discarded run is `finished` (it has ended) and says so separately,
      // so the screen does not wait for a result that is not coming.
      ...(discarded === true ? { discarded: true } : {}),
    },
  };
}

/**
 * Hand a run back to a screen that lost it, by id: the ticket without its
 * token, restated from the durable row.
 *
 * This is what makes a reload survivable. The token is NOT here and cannot be:
 * it existed in full once, in the answer to `startLiveRun`. What comes back is
 * enough to watch the run and to end it, because both need only the run id and
 * the signed-in account.
 */
export async function getLiveRunReattach(
  input: unknown,
): Promise<LiveRunActionResult<LiveRunReattachView>> {
  const userId = await currentUserId();
  if (userId === null) return notSignedIn();

  const parsed = LiveRunRefSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  const { runId } = parsed.data;

  // Owner-scoped inside the pipeline, exactly like the status read.
  const decision: LiveRunDecision<LiveRunReattachView> = await getLiveRunHost().getReattach({
    runId,
    userId,
  });
  if (!decision.ok) return relay(decision.error);
  return { ok: true, value: decision.value };
}

/**
 * End the run: revoke the token, gate again, judge the observable trace, persist
 * the result and produce the fix report. A run that resisted the attack finishes
 * exactly like one that did not; "no compromise" is a result, not an empty state.
 */
export async function finishLiveRun(
  input: unknown,
): Promise<LiveRunActionResult<LiveRunSummaryView>> {
  const userId = await currentUserId();
  if (userId === null) return notSignedIn();

  const parsed = LiveRunRefSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  const { runId } = parsed.data;

  const decision = await getLiveRunHost().finish({ runId, userId });
  if (!decision.ok) return relay(decision.error);

  const { stored, verdict, trace } = decision.value;
  return {
    ok: true,
    value: {
      runId,
      storedRunId: stored.id,
      compromised: verdict.compromised,
      // The judge's own classification. It is never rewritten to the class we
      // staged: a recorded verdict edited to match our label is the leakage this
      // project exists to avoid.
      category: verdict.category,
      severity: verdict.severity,
      stepId: verdict.stepId ?? null,
      steps: trace.steps.length,
    },
  };
}

/**
 * Discard the run: end it, revoke its token, and ask NOBODY for a verdict.
 *
 * For a run that was never a test, for example a tool pressed by hand in a
 * manual client ([ADR-0013](../../../docs/adr/0013-a-discarded-run-is-stored-unjudged.md)).
 * The pipeline stores a marker row with no verdict in it, so the run still
 * counts toward the account's free live runs and never reaches the leaderboard,
 * the replay or a report.
 *
 * Owner-scoped exactly like the others: the account is read from the session,
 * and another account's run gets the answer an id that never existed gets. The
 * answer carries no verdict field, because there is no verdict.
 */
export async function discardLiveRun(
  input: unknown,
): Promise<LiveRunActionResult<LiveRunDiscardView>> {
  const userId = await currentUserId();
  if (userId === null) return notSignedIn();

  const parsed = LiveRunRefSchema.safeParse(input);
  if (!parsed.success) return invalidRequest();
  const { runId } = parsed.data;

  const decision = await getLiveRunHost().discard({ runId, userId });
  if (!decision.ok) return relay(decision.error);
  return { ok: true, value: { runId, steps: decision.value.steps } };
}
