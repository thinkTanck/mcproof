import type { Category, VariantKind } from '@/contract';
import type {
  LiveRunActionCode,
  LiveRunActionResult,
  LiveRunPhase,
  LiveRunReattachView,
  LiveRunStatusView,
  LiveRunSummaryView,
  LiveRunTicketView,
} from '@/app/actions/live-run-contract';

/**
 * THE CONNECT SCREEN'S LOCAL PORT — the narrow thing the screen needs from the
 * server, and the ONE adapter at that boundary.
 *
 * Under [ADR-0006](../../../docs/adr/0006-mcpwn-is-the-mcp-server.md) a live run
 * is: we issue an endpoint and a token, the user's agent connects to US, and the
 * server records what it does. The screen therefore needs exactly four answers:
 *
 *   1. START — issue this run, or refuse it.
 *   2. READ STATE — what has the server actually observed since?
 *   3. FINISH — end it, judge it, and say where the result lives.
 *   4. REATTACH: hand a run back by its id, after a reload lost the page.
 *
 * That is the whole port. Anything the screen draws, it draws from those four
 * answers, which is what makes "show real connection state" enforceable rather
 * than aspirational: there is no further channel a fake state could come in on.
 *
 * REATTACH RETURNS NO TOKEN, AND THE ADAPTER MAKES SURE OF IT. The token is shown
 * once, when START answers. A reattached run is rebuilt field by field from the
 * view the server sent, so a token could not ride along even if an answer ever
 * carried one.
 *
 * FINISH IS HERE BECAUSE THE RUN CANNOT END WITHOUT IT. An earlier draft of this
 * port had two methods, on the reading that `task_complete` is inferred from
 * session close and therefore the server owned completion. The shipped lifecycle
 * says otherwise: `phase` becomes `finished` only once `finishLiveRun` has been
 * called, and the persisted row id the replay is addressed by
 * (`LiveRunSummaryView.storedRunId`) exists nowhere else. A screen that never
 * called finish would poll `connected` forever and could never hand off.
 *
 * ── THE VIEWS ARE THEIRS, NOT OURS ──
 *
 * `LiveRunTicketView`, `LiveRunStatusView` and `LiveRunSummaryView` are imported
 * from `@/app/actions/live-run-contract` rather than re-declared here. A parallel
 * copy of a shape is a copy that drifts, and that module is deliberately free of
 * `node:` anything so a client component can import its types. What this module
 * still owns is the ANSWER shape and the distrust.
 *
 * ── THE ADAPTER'S JOB IS DISTRUST ──
 *
 * It normalizes before the screen sees anything. A phase it does not recognise,
 * a count that is not a whole number, a summary with no stored id, a thrown call:
 * each becomes a stated refusal, never a rendered guess. A screen that draws an
 * unrecognised phase as if it understood it is exactly the fake progress this
 * redesign removes.
 *
 * The one thing the adapter NEVER does is rewrite a refusal sentence. The
 * allowance message is derived from configuration on the server
 * (`describeLiveRunAllowance`) and the spend-cap message deliberately quotes no
 * numeral at all; both arrive as finished copy and are printed as sent.
 */

export type {
  LiveRunPhase,
  LiveRunReattachView,
  LiveRunStatusView,
  LiveRunSummaryView,
  LiveRunTicketView,
};

/**
 * Why a live run did not proceed.
 *
 * The server's own union, plus two states only a client can be in: `NOT_WIRED`
 * (no action bound to the port at all) and `REFUSED` (the honest bucket for a
 * code this build does not know, so a newer server can add one without this
 * screen inventing a meaning for it).
 */
export type LiveRunRefusalCode = LiveRunActionCode | 'NOT_WIRED' | 'REFUSED';

/**
 * Every code the screen has copy of its own for. Kept as a list rather than
 * derived from the server's union, because "we have words for this" is a fact
 * about the screen, not about the server: a code added upstream lands in
 * `REFUSED` until somebody writes those words.
 */
const KNOWN_CODES: readonly LiveRunRefusalCode[] = [
  'NOT_SIGNED_IN',
  'ALLOWANCE_EXHAUSTED',
  'SPEND_CAP_REACHED',
  'GATE_UNAVAILABLE',
  'DETECTION_UNAVAILABLE',
  'DETECTION_FAILED',
  'RESULT_INVALID',
  'INVALID_REQUEST',
  'RUN_NOT_FOUND',
  'RUN_ALREADY_FINISHED',
  'NOT_WIRED',
  'REFUSED',
];

/** A refusal. `message` is already the sentence a screen prints, unedited. */
export interface LiveRunRefusal {
  readonly code: LiveRunRefusalCode;
  readonly message: string;
}

/**
 * The three phases the server can honestly report: `waiting`, `connected`,
 * `finished`.
 *
 * There is deliberately no "the agent is thinking" and no percentage: neither is
 * observable from the server side, and there is no total to be a percentage of.
 * There is no `recording` phase either. An earlier draft of this port invented
 * one; the server does not report it, so the screen does not claim it, and
 * whether the agent has actually DONE anything is read off `toolCalls` instead.
 */
const PHASES: readonly LiveRunPhase[] = ['waiting', 'connected', 'finished'];

/** An answer, never a throw for a state a visitor can provoke. */
export type LiveRunAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: LiveRunRefusal };

export interface ConnectLiveRunPort {
  /**
   * Issue this run's endpoint and token, or refuse.
   *
   * `kind` is the framing the run serves: the attack, or its tool-parity control
   * ([ADR-0003](../../../docs/adr/0003-core-7-scope-and-measurability-bar.md)
   * bar 4). It is OPTIONAL here because the default belongs to the server, which
   * has always applied `malicious`, and a screen that repeats a default is a
   * second place for it to drift. Omitting it is a real state, not a bug: it is
   * how a caller says "whatever the server runs by default".
   */
  start(input: {
    category: Category;
    kind?: VariantKind;
  }): Promise<LiveRunAnswer<LiveRunTicketView>>;
  /** What the server has actually observed on this run. */
  readState(input: { runId: string }): Promise<LiveRunAnswer<LiveRunStatusView>>;
  /** End it, judge it, persist it, and say where the result lives. */
  finish(input: { runId: string }): Promise<LiveRunAnswer<LiveRunSummaryView>>;
  /**
   * Hand a run back by its id: everything the ticket carried EXCEPT the token,
   * plus whether the run has finished and where its saved result lives.
   */
  reattach(input: { runId: string }): Promise<LiveRunAnswer<LiveRunReattachView>>;
}

// ── The boundary: the three server actions, declared structurally ──

/**
 * The shipped actions take `unknown` and Zod-validate on the server, so the
 * screen's job is to send the right thing rather than to be trusted about it.
 *
 * These three types are the WHOLE reconciliation surface with
 * `@/app/actions/live-run`, and `createConnectLiveRunPort` is the only place
 * they are used. There is no `userId` in any of them: the account is read from
 * the session on the server, so a caller cannot start a run as somebody else or
 * ask about a run they do not own.
 */
export type StartLiveRunAction = (
  input: unknown,
) => Promise<LiveRunActionResult<LiveRunTicketView>>;

export type ReadLiveRunStatusAction = (
  input: unknown,
) => Promise<LiveRunActionResult<LiveRunStatusView>>;

export type FinishLiveRunAction = (
  input: unknown,
) => Promise<LiveRunActionResult<LiveRunSummaryView>>;

export type ReattachLiveRunAction = (
  input: unknown,
) => Promise<LiveRunActionResult<LiveRunReattachView>>;

/** The four actions, as one injectable bundle. */
export interface ConnectLiveRunActions {
  readonly start: StartLiveRunAction;
  readonly status: ReadLiveRunStatusAction;
  readonly finish: FinishLiveRunAction;
  readonly reattach: ReattachLiveRunAction;
}

/** Nothing was issued because this build has no server action behind the screen. */
export const LIVE_RUN_NOT_WIRED_MESSAGE =
  'Starting a live run is not connected in this build, so nothing was issued and ' +
  'no token exists. Sample playback stays open to everyone.';

/** The server answered in a shape this build cannot read, so nothing is claimed. */
export const LIVE_RUN_UNREADABLE_STATE_MESSAGE =
  'We could not read this run just now, so nothing is being reported as observed. ' +
  'The run itself is unaffected.';

/** A call failed outright. The underlying detail is ours; it never becomes copy. */
export const LIVE_RUN_CALL_FAILED_MESSAGE =
  'We could not reach the run service just now, so nothing was started. Please try again.';

/** A finish call failed outright. The run is not lost; it can be ended again. */
export const LIVE_RUN_FINISH_FAILED_MESSAGE =
  'We could not reach the run service just now, so this run was not ended. Please try again.';

const refuse = (code: LiveRunRefusalCode, message: string): LiveRunAnswer<never> => ({
  ok: false,
  refusal: { code, message },
});

/** A code we have copy for, or the honest bucket. Never a silent reinterpretation. */
function readCode(code: string): LiveRunRefusalCode {
  return KNOWN_CODES.find((known) => known === code) ?? 'REFUSED';
}

/** Evidence has to be a whole, non-negative count, or it is not evidence. */
const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

const isId = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;

/**
 * A reading is trusted only if every field is one the screen can render
 * truthfully. A phase outside the three is a state we cannot observe, and a
 * count that is not a whole non-negative number is not a count.
 */
function readStatus(value: LiveRunStatusView): LiveRunStatusView | null {
  if (!PHASES.includes(value.phase)) return null;
  if (!isCount(value.steps) || !isCount(value.toolCalls)) return null;
  if (!isId(value.runId)) return null;
  return value;
}

/**
 * A summary is only useful if it carries the address the replay is fetched by.
 * Without `storedRunId` there is nothing to hand off to, and offering a link we
 * cannot build would be worse than saying we could not read the result.
 */
function readSummary(value: LiveRunSummaryView): LiveRunSummaryView | null {
  if (!isId(value.storedRunId) || !isId(value.runId)) return null;
  if (!isCount(value.steps)) return null;
  return value;
}

/**
 * A reattached run is only drawable if it says which run it is and where the
 * agent connects. It is REBUILT here rather than passed through, so the result
 * holds exactly the fields below and nothing an answer might have carried
 * besides them. There is no token among them.
 */
function readReattach(value: LiveRunReattachView): LiveRunReattachView | null {
  if (!isId(value.runId) || !isId(value.endpoint)) return null;
  if (typeof value.taskGoal !== 'string' || typeof value.promptName !== 'string') return null;
  if (typeof value.expiresAt !== 'string') return null;
  return {
    runId: value.runId,
    endpoint: value.endpoint,
    expiresAt: value.expiresAt,
    category: value.category,
    kind: value.kind,
    taskGoal: value.taskGoal,
    promptName: value.promptName,
    finishedAt: typeof value.finishedAt === 'string' ? value.finishedAt : null,
    storedRunId: isId(value.storedRunId) ? value.storedRunId : null,
  };
}

/**
 * THE ONE ADAPTER. Everything the screen knows about the server passes through
 * these three calls, so reconciling with the real actions is a change to this
 * file and nowhere else.
 *
 * It does two jobs and no others: it turns the server's FLAT failure
 * (`{ ok: false, code, message }`) into the screen's nested one
 * (`{ ok: false, refusal }`), and it refuses anything it cannot render honestly.
 */
export function createConnectLiveRunPort(actions: ConnectLiveRunActions): ConnectLiveRunPort {
  return {
    async start(input) {
      let answer: Awaited<ReturnType<StartLiveRunAction>>;
      try {
        // Spread rather than `kind: input.kind`: `StartLiveRunRequestSchema` is
        // strict, and a key the caller never set is a claim the caller never
        // made. An absent `kind` leaves the server's own default in charge.
        answer = await actions.start({
          category: input.category,
          ...(input.kind === undefined ? {} : { kind: input.kind }),
        });
      } catch {
        // The thrown detail belongs in our own telemetry, not on a visitor's
        // screen: it is the one thing here that could carry an internal name.
        return refuse('REFUSED', LIVE_RUN_CALL_FAILED_MESSAGE);
      }
      if (!answer.ok) return refuse(readCode(answer.code), answer.message);
      return { ok: true, value: answer.value };
    },

    async readState(input) {
      let answer: Awaited<ReturnType<ReadLiveRunStatusAction>>;
      try {
        answer = await actions.status({ runId: input.runId });
      } catch {
        return refuse('REFUSED', LIVE_RUN_UNREADABLE_STATE_MESSAGE);
      }
      if (!answer.ok) return refuse(readCode(answer.code), answer.message);
      const status = readStatus(answer.value);
      if (status === null) return refuse('REFUSED', LIVE_RUN_UNREADABLE_STATE_MESSAGE);
      return { ok: true, value: status };
    },

    async finish(input) {
      let answer: Awaited<ReturnType<FinishLiveRunAction>>;
      try {
        answer = await actions.finish({ runId: input.runId });
      } catch {
        return refuse('REFUSED', LIVE_RUN_FINISH_FAILED_MESSAGE);
      }
      if (!answer.ok) return refuse(readCode(answer.code), answer.message);
      const summary = readSummary(answer.value);
      if (summary === null) return refuse('REFUSED', LIVE_RUN_UNREADABLE_STATE_MESSAGE);
      return { ok: true, value: summary };
    },

    async reattach(input) {
      let answer: Awaited<ReturnType<ReattachLiveRunAction>>;
      try {
        answer = await actions.reattach({ runId: input.runId });
      } catch {
        return refuse('REFUSED', LIVE_RUN_UNREADABLE_STATE_MESSAGE);
      }
      if (!answer.ok) return refuse(readCode(answer.code), answer.message);
      const view = readReattach(answer.value);
      if (view === null) return refuse('REFUSED', LIVE_RUN_UNREADABLE_STATE_MESSAGE);
      return { ok: true, value: view };
    },
  };
}

/**
 * The fallback for a console rendered with no actions bound to it.
 *
 * `/connect` binds the real actions, so this is not a production state. It exists
 * so that a console rendered without a port cannot invent one: it refuses,
 * plainly, mints nothing and claims nothing, the same way `resolveLiveDetector()`
 * returns `null` rather than judging with something unvalidated.
 */
export const notWiredLiveRunPort: ConnectLiveRunPort = {
  async start() {
    return refuse('NOT_WIRED', LIVE_RUN_NOT_WIRED_MESSAGE);
  },
  async readState() {
    return refuse('NOT_WIRED', LIVE_RUN_NOT_WIRED_MESSAGE);
  },
  async finish() {
    return refuse('NOT_WIRED', LIVE_RUN_NOT_WIRED_MESSAGE);
  },
  async reattach() {
    return refuse('NOT_WIRED', LIVE_RUN_NOT_WIRED_MESSAGE);
  },
};
