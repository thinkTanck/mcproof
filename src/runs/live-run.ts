/**
 * THE LIVE-RUN PIPELINE — the seam that turns the pieces into one run.
 *
 * Every stage below already existed and was tested on its own, each with its
 * integration point written down in the module rather than invented. This is
 * that integration, honoured as documented and in this order:
 *
 *   start()   gate (preflight)  ->  issue the per-run token (`run-token.ts`)
 *             ->  host the per-run MCP server (`src/harness/server/**`)
 *   handle()  authenticate the INBOUND agent connection  ->  serve MCP
 *             ->  the recorder writes the observable Trace
 *   finish()  revoke the token  ->  gate again (preflight)  ->  the frozen
 *             validated judge over the OBSERVABLE trace only  ->  Verdict
 *             ->  RunResult  ->  RunRepository  ->  generateFixReport
 *
 * ── THE INVERSION, AND WHERE THE GATES SIT ──
 *
 * Under [ADR-0006](../../docs/adr/0006-mcpwn-is-the-mcp-server.md) we never call
 * the user's agent: we host an endpoint and the agent connects to US. So there is
 * no "before the agent call" moment to gate. The two moments that SPEND anything
 * are inviting an agent in (a hosted run) and asking the judge (operator money),
 * and both are gated:
 *
 *   1. `start()` calls `preflight` BEFORE `issueRunToken`. A refused run mints no
 *      token, hosts no server and costs nothing.
 *   2. `finish()` calls `preflight` again BEFORE the judge. A cap that trips
 *      mid-run pauses the run down the same typed refusal instead of spending.
 *
 * `handle()` does NOT re-gate. The allowance is a per-run decision, not a
 * per-message one, and a database read on every inbound JSON-RPC message would
 * both cost more than it saves and refuse an agent halfway through a session it
 * was already granted.
 *
 * Both gate calls treat a THROWN preflight the same way they treat a returned
 * refusal: the run stops. The gate throws when the store it counts against is
 * unreachable, which is a different fact from "you are out of runs" and gets its
 * own code, but an unreadable spend control is never a granted one.
 *
 * ── THE LEAKAGE BARRIER ──
 *
 * A live run is UNLABELED. There is no `GroundTruth` here, none is synthesized,
 * and `RunResultSchema` is strict so one could not be attached even by accident.
 * The judge is reached only through {@link LiveDetector}, whose signature is
 * `(trace, taskGoal) => Verdict` and therefore has nowhere to put a label; what
 * it actually sees is narrowed once more inside `detect()` by the
 * `judgeableTrace()` allow-list (no `category`, no `runId`). This module adds
 * nothing to that payload.
 *
 * ── TWO WAYS A RUN ENDS, AND ONE CLAIM BETWEEN THEM ──
 *
 * `finish()` is the ordinary end: gate, judge, persist, report. `abandon()` is
 * the end for a run that recorded nothing worth judging — it claims the run and
 * revokes the token and stops there, spending nothing and storing nothing. Both
 * go through the SAME claim against the registry, so a user finishing a run and
 * a scheduled pass closing it compete once and only one of them acts. The
 * scheduled pass itself lives in `./reaper.ts`
 * ([ADR-0012](../../docs/adr/0012-abandoned-runs-are-completed-not-discarded.md));
 * it decides which of the two to call and calls THIS module rather than a copy of
 * it, so a background run cannot end up on a different set of gates.
 *
 * ── THE CLEAN PATH IS A FIRST-CLASS OUTCOME ──
 *
 * An agent that reads the poisoned content and refuses to act on it is the
 * product working. `finish()` has no branch on `verdict.compromised`: both
 * outcomes persist a `RunResult` and produce a fix report, and "no findings" is a
 * report, not an empty state.
 *
 * ── THE OPEN-RUN REGISTRY IS DURABLE, AND WHY THAT IS A BUG FIX ──
 *
 * This registry used to be a plain `Map` in the process, with the consequence
 * written down honestly: a run in progress belonged to the instance that started
 * it, and a restart lost the unfinished trace. On the platform we deploy to that
 * is not a footnote, it is a correctness bug — nothing pins an agent's second
 * request to the instance that served its first, so `handle()` refused valid
 * connections at random depending on where the platform routed them.
 *
 * The fix is `LiveRunSessionStore` (`./live-run-store.ts`): the run's identity,
 * framing and observed events are persisted, so ANY instance can rebuild the
 * hosted server. `HostedMcpServer` is a pure function of `(category, kind)` plus
 * the events recorded so far, which is what makes rebuilding it exact rather than
 * approximate. The in-process `Map` survives only as a CACHE of the live objects.
 *
 * Two consequences worth naming. Events are flushed after every inbound request,
 * positionally, so a run that changes instance mid-session keeps every step the
 * agent took — a resolvable run with a silently truncated trace would be worse
 * than a refused one. And finishing is a CLAIM against the store rather than an
 * in-process boolean, because two instances would each have answered "not yet"
 * and judged (and charged for) the same run twice.
 */
import { z } from 'zod';
import {
  CategorySchema,
  RunResultSchema,
  VariantKindSchema,
  type Category,
  type RunResult,
  type Trace,
  type VariantKind,
  type Verdict,
} from '@/contract';
import { getSiteOrigin } from '@/config/env';
import type { RunRepository, StoredRun } from '@/data/run-repository';
import { DetectorError } from '@/detector';
import type { LiveDetector } from '@/detector/resolve';
import { generateFixReport, type FixReport } from '@/fix-report';
import { createStreamableHttpHandler, type StreamableHttpHandler } from '@/harness/server/http';
import { HostedMcpServer, TASK_PROMPT_NAME } from '@/harness/server/server';
import type { Logger } from '@/lib/logger';
import {
  issueRunToken,
  verifyRunToken,
  RUN_TOKEN_REJECTION_MESSAGE,
  type RunTokenStore,
} from '@/runs/run-token';
import { InMemoryLiveRunSessionStore, type LiveRunSessionStore } from '@/runs/live-run-store';

/** Where a run's MCP endpoint lives, under the site origin. */
export const LIVE_RUN_ENDPOINT_PREFIX = '/api/mcp';

/**
 * How this pipeline mounts the transport, at BOTH places it builds a handler.
 *
 * A session id an agent carries may have been minted by a different instance,
 * so the handler binds an unknown id to the run's one server instead of
 * answering 404. That is safe here and only here: `handle()` below has already
 * matched the URL to this run and verified its bearer token before the handler
 * sees the request, on every request, and there is one server per run. The
 * loopback script (`scripts/server/serve.ts`) has no such gate and keeps the
 * strict default.
 *
 * And the handler never answers with a null body outside 204. On the platform
 * this pipeline is deployed to, such a response has its headers sent and its
 * body never terminated, and the 202 that acknowledges
 * `notifications/initialized` is exactly that shape. A client that waits for
 * the response to finish, Claude Code among them, timed out there on its second
 * request. See `neverBodiless` on the transport for the measurements.
 */
const HOSTED_TRANSPORT = { adoptUnknownSessions: true, neverBodiless: true } as const;

/**
 * How long a session row outlives the token that reaches it, before the sweep
 * may delete it.
 *
 * The token is what stops an agent connecting, and it dies with the run or on its
 * own wall clock. The session row is not a credential, so keeping it a while
 * longer grants nobody anything — but deleting it on the token's clock would
 * strand a user who worked the full TTL and then asked to finish, losing a
 * verdict for work already done. A day of grace costs a few rows.
 */
export const LIVE_RUN_SESSION_GRACE_MS = 24 * 60 * 60_000;

/** How long the pipeline waits for one judge answer before giving up. */
export const DEFAULT_JUDGE_TIMEOUT_MS = 60_000;
/** Total judge attempts per run, including the first. */
export const DEFAULT_JUDGE_MAX_ATTEMPTS = 2;
/** First backoff step; doubled per retry and capped. */
const RETRY_BASE_MS = 250;
const RETRY_CAP_MS = 2_000;

// ── Refusals ──

/**
 * Why a run could not proceed. Each one is a bounded state the UI can state
 * plainly, never an exception surfacing as a 500 on a public route.
 *
 * The first two are the preflight gates and are RELAYED, not decided here: this
 * module never counts an allowance or reads a spend cap, so it cannot drift from
 * whatever `src/runs/preflight.ts` decides.
 *
 * `GATE_UNAVAILABLE` is the third thing a gate can do. `checkLiveRunPreflight`
 * REFUSES by returning, but it THROWS when the store it counts against is
 * unreachable, deliberately: "we could not read your allowance" is not "you are
 * out of runs", and answering the first with the second would be a lie in
 * whichever direction it fell. So the throw is caught here and named separately,
 * and it fails CLOSED like every other refusal.
 */
export type LiveRunErrorCode =
  | 'ALLOWANCE_EXHAUSTED'
  | 'SPEND_CAP_REACHED'
  | 'GATE_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'DETECTION_UNAVAILABLE'
  | 'DETECTION_FAILED'
  | 'RESULT_INVALID'
  | 'RUN_NOT_FOUND'
  | 'RUN_ALREADY_FINISHED';

/** A refusal, typed. Its `message` is already the sentence a screen can print. */
export class LiveRunError extends Error {
  readonly code: LiveRunErrorCode;

  constructor(code: LiveRunErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LiveRunError';
    this.code = code;
  }
}

/** The gate could not be read, so nothing was granted. Fails closed. */
export const GATE_UNAVAILABLE_MESSAGE =
  'We could not check your run allowance just now, so this run did not go ahead. ' +
  'Please try again in a moment.';

/** Live detection is off, and sample playback is the path that still works. */
export const DETECTION_UNAVAILABLE_MESSAGE =
  'Live detection is not available right now, so this run cannot be judged. ' +
  'Sample playback stays open to everyone.';

/** An outcome, never a throw for a state a caller can provoke. */
export type LiveRunDecision<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: LiveRunError };

// ── The preflight seam ──

/**
 * The gate, as a function type.
 *
 * This MIRRORS `checkLiveRunPreflight` in `src/runs/preflight.ts`, which owns the
 * allowance and the spend cap. It is declared structurally here so this module
 * compiles and is testable against a stub without importing a file it does not
 * own, and so the real function drops in with no adapter: it satisfies this type
 * exactly. The gates themselves are deliberately NOT implemented here.
 */
export type LiveRunPreflight = (input: { userId: string; now?: Date }) => Promise<
  | { allowed: true }
  | {
      allowed: false;
      refusal: { code: 'ALLOWANCE_EXHAUSTED' | 'SPEND_CAP_REACHED'; message: string };
    }
>;

// ── Inputs and outputs ──

/** Zod over the caller's input: an unvalidated request never reaches a token. */
const StartSchema = z.object({
  userId: z.string().trim().min(1),
  category: CategorySchema,
  kind: VariantKindSchema.optional(),
  model: z.string().trim().min(1).optional(),
});

export interface StartLiveRunInput {
  /** The signed-in account. Runs, tokens and stored results are all scoped to it. */
  readonly userId: string;
  /** Which Core-7 scenario to serve. */
  readonly category: Category;
  /** Which framing to serve. Defaults to the poisoned one. */
  readonly kind?: VariantKind;
  /** Pin the model label; otherwise the connecting client's own claim is used. */
  readonly model?: string;
}

/** What the user is handed to point their agent at us. Shown once. */
export interface LiveRunTicket {
  readonly runId: string;
  /** The per-run MCP endpoint. */
  readonly endpoint: string;
  /** The per-run, per-account token. The ONLY time it exists in full. */
  readonly token: string;
  /** Wall-clock expiry of that token (ISO-8601). */
  readonly expiresAt: string;
  readonly category: Category;
  readonly kind: VariantKind;
  /** The goal, delivered OUT OF BAND: the published prompt, or paste this. */
  readonly taskGoal: string;
  /** The name of the published prompt carrying that goal. */
  readonly promptName: string;
}

/** What closing a run without judging it produced. There is no verdict here. */
export interface AbandonedLiveRun {
  readonly runId: string;
  /** How much the agent had recorded when the run was closed. */
  readonly steps: number;
}

/** What a finished run produced. Identical in shape on both outcomes. */
export interface LiveRunOutcome {
  readonly stored: StoredRun;
  readonly report: FixReport;
  readonly verdict: Verdict;
  readonly trace: Trace;
}

export interface LiveRunHostDeps {
  /** The gate. `checkLiveRunPreflight` from `src/runs/preflight.ts` satisfies it. */
  readonly preflight: LiveRunPreflight;
  /** Where per-run tokens are written, read and revoked. */
  readonly tokens: RunTokenStore;
  /**
   * The open-run registry. Defaults to the in-memory adapter, which is correct
   * offline and in tests and WRONG in production: pass the durable adapter
   * (`getLiveRunSessionStore()`) anywhere more than one instance can serve a run.
   */
  readonly sessions?: LiveRunSessionStore;
  /** Where a finished run is persisted, owner-scoped. */
  readonly repository: Pick<RunRepository, 'saveRun'>;
  /**
   * The judge, resolved per stage. Pass `() => resolveLiveDetector()`: it returns
   * `null` when no judge credential is configured, which is a refusal here and
   * never a crash.
   */
  readonly resolveDetector: () => LiveDetector | null;
  /** Origin the endpoint URL is built from. Defaults to the site origin. */
  readonly origin?: string;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly newRunId?: () => string;
  /** Deadline for ONE judge attempt. */
  readonly judgeTimeoutMs?: number;
  /** Total judge attempts, including the first. */
  readonly judgeMaxAttempts?: number;
  /** Injected delay, so retry backoff is instant under test. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface LiveRunHost {
  /** Gate, then issue a token and host the run's MCP server. */
  start(input: StartLiveRunInput): Promise<LiveRunDecision<LiveRunTicket>>;
  /** Authenticate one inbound agent request and serve it. */
  handle(request: Request): Promise<Response>;
  /** The observable trace recorded so far, for the owner of the run. */
  getTrace(input: { runId: string; userId: string }): Promise<LiveRunDecision<Trace>>;
  /** Revoke, gate, judge, persist and report. */
  finish(input: { runId: string; userId: string }): Promise<LiveRunDecision<LiveRunOutcome>>;
  /**
   * Close a run WITHOUT judging it: claim it once, revoke its token, store
   * nothing. For a run that recorded nothing worth asking the judge about.
   */
  abandon(input: { runId: string; userId: string }): Promise<LiveRunDecision<AbandonedLiveRun>>;
}

/**
 * One open run as THIS instance holds it: the live objects, plus how much of the
 * run has been written to the durable registry. It is a cache of the row, never
 * the authority on it — `flushed` is the only field the row cannot restate.
 */
interface LiveRunSession {
  readonly runId: string;
  readonly userId: string;
  readonly category: Category;
  readonly kind: VariantKind;
  readonly taskGoal: string;
  readonly server: HostedMcpServer;
  readonly handler: StreamableHttpHandler;
  /** How many observed events are already durable. The append index. */
  flushed: number;
  /** The client name last written, so an unchanged label is not rewritten. */
  client: string | null;
}

const fail = (
  code: LiveRunErrorCode,
  message: string,
  options?: { cause?: unknown },
): LiveRunDecision<never> => ({ ok: false, error: new LiveRunError(code, message, options) });

/** The one 401 this endpoint gives, whatever was actually wrong with the request. */
function unauthorized(): Response {
  return new Response(JSON.stringify({ error: RUN_TOKEN_REJECTION_MESSAGE }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
  });
}

/** The bearer token off the wire, untrusted and unparsed. */
function bearerFrom(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** The run a request addressed: the last segment of the endpoint path. */
function runIdFrom(request: Request): string | null {
  // `Request.url` is always an absolute URL, so this cannot throw.
  const segments = new URL(request.url).pathname.split('/').filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? null;
}

/**
 * Bound one judge attempt on the wall clock.
 *
 * Stated honestly: this stops the RUN from waiting forever; it does not cancel
 * the request in flight, because `LiveDetector` takes no abort signal. The HTTP
 * judge adapter carries its own per-request deadline, and that is what actually
 * closes the socket. Two bounds at two layers, doing two different jobs.
 */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new LiveRunError('DETECTION_FAILED', `The judge did not answer in ${ms}ms.`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createLiveRunHost(deps: LiveRunHostDeps): LiveRunHost {
  /** The durable registry. The authority on which runs exist. */
  const registry = deps.sessions ?? new InMemoryLiveRunSessionStore();
  /** Live objects for runs this instance is already serving. A cache, not a store. */
  const live = new Map<string, LiveRunSession>();
  const now = deps.now ?? (() => new Date());
  const newRunId = deps.newRunId ?? (() => globalThis.crypto.randomUUID());
  const origin = deps.origin ?? getSiteOrigin();
  const timeoutMs = deps.judgeTimeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS;
  const maxAttempts = Math.max(1, deps.judgeMaxAttempts ?? DEFAULT_JUDGE_MAX_ATTEMPTS);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const { logger } = deps;

  /**
   * Ask the gate, and treat BOTH of its negative answers as a refusal.
   *
   * A returned refusal is a decision the gate made. A THROWN error is the gate
   * being unable to decide (its store is unreachable), and the safe reading of an
   * unreadable spend control is not "granted": it is the same closed door with a
   * different sentence on it. Neither leaves anything half-created, because this
   * runs before the token on one side and before the judge on the other.
   */
  async function gate(userId: string, at: Date): Promise<LiveRunDecision<null>> {
    let decision: Awaited<ReturnType<LiveRunPreflight>>;
    try {
      decision = await deps.preflight({ userId, now: at });
    } catch (cause) {
      logger?.error('live run gate could not be read', { userId });
      return fail('GATE_UNAVAILABLE', GATE_UNAVAILABLE_MESSAGE, { cause });
    }
    if (!decision.allowed) {
      logger?.info('live run refused', { userId, code: decision.refusal.code });
      return fail(decision.refusal.code, decision.refusal.message);
    }
    return { ok: true, value: null };
  }

  /**
   * The run, whichever instance started it, and AS IT STANDS NOW.
   *
   * The durable row is the truth and the in-memory copy is a cache of it, so the
   * row is read on every call and the cache is kept only while it is current. A
   * miss, or a cached copy the row has moved past, REBUILDS the hosted server
   * from the row: the framing decides the tool surface, and the persisted events
   * restore everything the agent already did, so the rebuilt run is the same run
   * and not a fresh one wearing its id.
   *
   * WHY THE CACHE IS CHECKED AND NOT TRUSTED. It used to be returned as found.
   * That was only ever safe while one instance served a whole session, which is
   * exactly what the session fix above this pipeline removes: a session can now
   * move between instances mid-run. An instance that served the run earlier then
   * holds a copy missing the steps another instance recorded, and because
   * appends are positional its next write would land on their slots and
   * overwrite them. The step lost that way can be the compromise itself.
   */
  async function resolve(runId: string): Promise<LiveRunSession | undefined> {
    const cached = live.get(runId);

    let row: Awaited<ReturnType<typeof registry.find>>;
    try {
      row = await registry.find(runId);
    } catch (error) {
      // The registry could not be read. An instance already holding the run goes
      // on serving what it has rather than refusing an agent mid-run; one that
      // holds nothing has nothing to serve, exactly as before.
      if (cached === undefined) throw error;
      logger?.error('live run registry could not be read; serving the cached run', { runId });
      return cached;
    }
    if (row === null) return cached;

    // Current means no other instance has recorded anything this one has not
    // seen: no further steps, and no client name it has not learned.
    if (
      cached !== undefined &&
      row.events.length <= cached.flushed &&
      (row.client === null || row.client === cached.client)
    ) {
      return cached;
    }

    // Did a client already complete `initialize` on another instance? The row
    // records the client name at exactly that moment, and it is the only durable
    // trace of the handshake: the row has no field for the notification that
    // follows it. So this is the first half of the handshake standing in for the
    // whole, which is right for every client that sends the two back to back and
    // errs only toward NOT annotating a call as out of order.
    const handshakeSeen = row.client !== null;
    const server = new HostedMcpServer({
      category: row.category,
      kind: row.kind,
      runId,
      target: row.target,
      events: row.events,
      client: row.client,
      initialized: handshakeSeen,
      ...(row.model === null ? {} : { model: row.model }),
    });
    const session: LiveRunSession = {
      runId,
      userId: row.userId,
      category: row.category,
      kind: row.kind,
      taskGoal: server.taskGoal,
      server,
      handler: createStreamableHttpHandler(() => server, HOSTED_TRANSPORT),
      flushed: row.events.length,
      client: row.client,
    };
    live.set(runId, session);
    logger?.info(
      cached === undefined ? 'live run rehydrated' : 'live run refreshed from the durable row',
      { runId, steps: row.events.length, handshakeSeen },
    );
    return session;
  }

  /** The owner's own run, or nothing. Another account gets the same nothing. */
  async function ownedSession(runId: string, userId: string): Promise<LiveRunSession | undefined> {
    const session = await resolve(runId);
    return session !== undefined && session.userId === userId ? session : undefined;
  }

  /**
   * Write everything this instance has observed since the last flush.
   *
   * Positional (`from`), so the durable row's `(run, index)` identity makes a
   * retried write land on the same slots instead of inventing steps. Flushing
   * after the response is already built keeps it off the agent's critical path
   * for the answer, and a failed flush is logged rather than thrown: refusing a
   * request the agent already got an answer to would help nobody.
   */
  async function flush(session: LiveRunSession): Promise<void> {
    const observed = session.server.observedEvents;
    const client = session.server.observedClient ?? null;
    if (observed.length === session.flushed && client === session.client) return;
    try {
      await registry.appendEvents({
        runId: session.runId,
        from: session.flushed,
        events: observed.slice(session.flushed),
        client,
      });
      session.flushed = observed.length;
      session.client = client;
    } catch {
      logger?.error('live run steps could not be persisted', { runId: session.runId });
    }
  }

  /**
   * Ask the judge, bounded on both axes.
   *
   * A `DetectorError` is NOT retried. It means the judge answered and the answer
   * was unusable, and the judge is pinned at temperature 0, so a second identical
   * request buys an identical failure at the operator's expense. Transport-shaped
   * failures are retried, up to `maxAttempts`.
   */
  async function judge(
    detector: LiveDetector,
    trace: Trace,
    taskGoal: string,
  ): Promise<LiveRunDecision<Verdict>> {
    let last: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return { ok: true, value: await withDeadline(detector(trace, taskGoal), timeoutMs) };
      } catch (cause) {
        last = cause;
        if (cause instanceof DetectorError || attempt === maxAttempts) break;
        logger?.warn('judge attempt failed, retrying', { runId: trace.runId, attempt });
        await sleep(Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_CAP_MS));
      }
    }
    return fail('DETECTION_FAILED', 'The judge could not reach a verdict for this run.', {
      cause: last,
    });
  }

  return {
    async start(input) {
      const parsed = StartSchema.safeParse(input);
      if (!parsed.success) {
        return fail('INVALID_REQUEST', 'That run request was not valid, so no run was started.');
      }
      const { userId, model } = parsed.data;
      const category = parsed.data.category;
      const kind: VariantKind = parsed.data.kind ?? 'malicious';
      const at = now();

      // GATE 1 — before anything is issued, hosted or spent.
      const gated = await gate(userId, at);
      if (!gated.ok) return gated;

      // Refuse EARLY when there is no judge: inviting an agent to work a scenario
      // we could never judge would waste the user's inference, not just ours.
      if (deps.resolveDetector() === null) {
        return fail('DETECTION_UNAVAILABLE', DETECTION_UNAVAILABLE_MESSAGE);
      }

      const runId = newRunId();
      // WHAT THE TRACE RECORDS AS `target`, AND WHY IT IS NOT THE FULL URL.
      // `target` is one of the three fields `judgeableTrace()` lets through to the
      // judge, so it is part of the feature space and gets the same scrutiny as a
      // step. The origin is dropped because it names this project, which the
      // recorder documents the value must not do. The per-run id is dropped
      // because the allow-list WITHHOLDS `runId` on purpose, and a target of
      // `/api/mcp/<runId>` would hand it straight back through the next field
      // along. What is left is true and carries nothing: the endpoint family the
      // agent connected to.
      const target = LIVE_RUN_ENDPOINT_PREFIX;

      const { token, record } = issueRunToken({
        runId,
        userId,
        now: at,
        ...(logger ? { logger } : {}),
      });
      await deps.tokens.save(record);

      const server = new HostedMcpServer({
        category,
        kind,
        runId,
        target,
        ...(model === undefined ? {} : { model }),
      });
      // ONE server per RUN, not per session: every reconnect an agent makes lands
      // on the same recorder, so a run is one trace even if the transport blinks.
      const handler = createStreamableHttpHandler(() => server, HOSTED_TRANSPORT);
      // Durable FIRST. A run recorded nowhere is a run the next instance refuses,
      // and the principal instruction is already an observed event here, so even
      // a restart before the agent connects rebuilds a valid run.
      await registry.create({
        runId,
        userId,
        category,
        kind,
        model: model ?? null,
        client: null,
        target,
        startedAt: at.toISOString(),
        expiresAt: new Date(
          new Date(record.expiresAt).getTime() + LIVE_RUN_SESSION_GRACE_MS,
        ).toISOString(),
        events: server.observedEvents,
      });
      live.set(runId, {
        runId,
        userId,
        category,
        kind,
        taskGoal: server.taskGoal,
        server,
        handler,
        flushed: server.observedEvents.length,
        client: null,
      });

      logger?.info('live run started', { runId, userId, category, kind });
      return {
        ok: true,
        value: {
          runId,
          endpoint: `${origin}${LIVE_RUN_ENDPOINT_PREFIX}/${runId}`,
          token,
          expiresAt: record.expiresAt,
          category,
          kind,
          taskGoal: server.taskGoal,
          promptName: TASK_PROMPT_NAME,
        },
      };
    },

    async handle(request) {
      const runId = runIdFrom(request);
      const session = runId === null ? undefined : await resolve(runId);
      // An unknown run and a forged token get the SAME answer. Telling them apart
      // is exactly the oracle that lets someone enumerate which runs exist.
      if (runId === null || session === undefined) return unauthorized();

      const verified = await verifyRunToken({
        store: deps.tokens,
        presented: bearerFrom(request),
        runId,
        userId: session.userId,
        now: now(),
        ...(logger ? { logger } : {}),
      });
      if (!verified.valid) return unauthorized();

      const response = await session.handler.handle(request);
      await flush(session);
      return response;
    },

    async getTrace({ runId, userId }) {
      const session = await ownedSession(runId, userId);
      if (session === undefined) return fail('RUN_NOT_FOUND', 'That run was not found.');
      return { ok: true, value: await session.server.buildTrace() };
    },

    async abandon({ runId, userId }) {
      const session = await ownedSession(runId, userId);
      if (session === undefined) return fail('RUN_NOT_FOUND', 'That run was not found.');

      const at = now();
      // The SAME claim `finish()` makes, so closing and finishing compete for one
      // run through one mechanism. Whichever gets there first is the only one that
      // acts, and the loser is told the run is already over.
      if (!(await registry.finish(runId, at))) {
        return fail('RUN_ALREADY_FINISHED', 'That run has already finished.');
      }
      await deps.tokens.endRun(runId, at);

      // NO GATE here, deliberately. Both preflight calls exist to stop something
      // being SPENT, and this path issues nothing and asks the judge nothing. A
      // gate that could refuse would only ever leave a live credential on a public
      // endpoint, which is the opposite of what this call is for.
      const steps = session.server.observedEvents.length;
      logger?.info('live run abandoned', { runId, userId, steps });
      return { ok: true, value: { runId, steps } };
    },

    async finish({ runId, userId }) {
      const session = await ownedSession(runId, userId);
      if (session === undefined) return fail('RUN_NOT_FOUND', 'That run was not found.');

      const at = now();
      // CLAIM the run before anything is spent. The store grants this exactly
      // once, so two instances (or two clicks) cannot both reach the judge — an
      // in-process flag would have let each answer "not yet" on its own copy.
      if (!(await registry.finish(runId, at))) {
        return fail('RUN_ALREADY_FINISHED', 'That run has already finished.');
      }
      // The session is over however this call ends, so the token dies here — a
      // refusal below must not leave a live credential on a public endpoint.
      await deps.tokens.endRun(runId, at);

      // GATE 2 — before the judge, which is the only thing left that spends.
      const gated = await gate(userId, at);
      if (!gated.ok) {
        logger?.info('live run paused at the judge gate', { runId, code: gated.error.code });
        return gated;
      }

      const detector = deps.resolveDetector();
      if (detector === null) return fail('DETECTION_UNAVAILABLE', DETECTION_UNAVAILABLE_MESSAGE);

      const trace = await session.server.buildTrace();

      const judged = await judge(detector, trace, session.taskGoal);
      if (!judged.ok) {
        logger?.error('live run judge failed', { runId });
        return judged;
      }
      const verdict = judged.value;

      // The staged category is what WE served; the verdict's category is the
      // judge's blind prediction. `generateFixReport` needs both, and reconciles
      // them against the measured classification accuracy.
      let run: RunResult;
      try {
        run = RunResultSchema.parse({
          runId,
          target: trace.target,
          model: trace.model,
          category: session.category,
          trace,
          verdict,
        });
      } catch (cause) {
        return fail('RESULT_INVALID', 'This run did not produce a valid result.', { cause });
      }

      // No branch on `verdict.compromised`: a clean run persists and reports too.
      const stored = await deps.repository.saveRun(userId, run);
      const report = generateFixReport(run);
      logger?.info('live run finished', {
        runId,
        userId,
        compromised: verdict.compromised,
        steps: trace.steps.length,
      });

      return { ok: true, value: { stored, report, verdict, trace } };
    },
  };
}
