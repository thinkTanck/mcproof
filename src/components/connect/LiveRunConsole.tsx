'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { ClientSetup } from './ClientSetup';
import { CopyOut } from './CopyOut';
import { RUN_TYPE_LABEL } from './run-kinds';
import {
  notWiredLiveRunPort,
  type ConnectLiveRunPort,
  type LiveRunPhase,
  type LiveRunReattachView,
  type LiveRunRefusal,
  type LiveRunRefusalCode,
  type LiveRunStatusView,
  type LiveRunSummaryView,
  type LiveRunTicketView,
} from './live-run-port';
import type { Category, VariantKind } from '@/contract';

/**
 * THE LIVE CONSOLE — the Connect screen under the inverted model
 * ([ADR-0006](docs/adr/0006-mcpwn-is-the-mcp-server.md)).
 *
 * The old panel asked for the user's agent endpoint and API key so we could call
 * them. We never call their agent. This panel does the inverse and says so on the
 * face of it: it ISSUES a per-run endpoint and token, explains how the task goal
 * reaches the agent when the protocol has no way to push it, and then WAITS on
 * state the server really observed.
 *
 * ── THE THREE RULES THIS PANEL IS BUILT AROUND ──
 *
 * 1. THE TOKEN IS A SECRET SHOWN ONCE. It lives in React state for the life of
 *    this component and nowhere else: no input element, no storage, no URL, no
 *    log. It is masked until revealed and copies while masked.
 *
 *    THE RUN ID IS NOT THE TOKEN, AND IT DOES TRAVEL. The screen above puts the
 *    run id in the URL, and a console handed one (`reattachRunId`) reopens that
 *    run from its durable row: state, counts and the END RUN control come back,
 *    because ending a run needs the id and the signed-in account. The token does
 *    not come back. A reopened run shows no token and no client setup, and when
 *    its agent never connected it says the only true thing: it cannot be
 *    registered any more, so issue a fresh one.
 *
 * 2. A STATE WE CANNOT OBSERVE IS NOT DRAWN. There is no progress bar, because
 *    there is no total; no "the agent is thinking", because reasoning is not
 *    observable from the server side and is never synthesized. Every phase on
 *    screen came from a real reading, dated with when it was taken.
 *
 * 3. A REFUSAL FAILS CLOSED AND SAYS SO CALMLY. The allowance sentence is derived
 *    from configuration on the server and the spend-cap sentence quotes no
 *    numeral at all; this component prints what it was handed and authors
 *    neither. Refusals wear CAUTION, never the breach red: being out of free runs
 *    is not a compromise.
 *
 * ── WHY TOOL CALLS ARE THE HEADLINE NUMBER, NOT STEPS ──
 *
 * `LiveRunStatusView.steps` counts the whole observable trace, which includes the
 * principal instruction we put there ourselves and the inferred completion step.
 * It is therefore NEVER zero on a live run: a run where the agent connected and
 * did nothing at all still reports steps. Printing that under a label like "steps
 * recorded" would assert activity that never happened, on the one panel whose
 * entire job is showing real state. So the DISPLAY numeral is `toolCalls` — the
 * calls the agent itself chose to make, which is the signal a red-team run is
 * actually watching — and `steps` is shown beside it, named for what it is and
 * with its two inclusions stated.
 */

/** How often the panel asks the server what it has seen. */
export const DEFAULT_POLL_INTERVAL_MS = 4000;

/** Heading per refusal. A label, not a sentence: the sentence comes from the server. */
const REFUSAL_HEADINGS: Record<LiveRunRefusalCode, string> = {
  NOT_SIGNED_IN: 'SIGN IN TO RUN LIVE',
  ALLOWANCE_EXHAUSTED: 'FREE LIVE RUNS USED',
  SPEND_CAP_REACHED: 'LIVE RUNS PAUSED',
  GATE_UNAVAILABLE: 'ALLOWANCE CHECK UNAVAILABLE',
  DETECTION_UNAVAILABLE: 'DETECTOR UNAVAILABLE',
  DETECTION_FAILED: 'DETECTOR DID NOT ANSWER',
  RESULT_INVALID: 'RUN RESULT UNUSABLE',
  INVALID_REQUEST: 'RUN REQUEST REFUSED',
  RUN_NOT_FOUND: 'RUN NOT FOUND',
  RUN_ALREADY_FINISHED: 'RUN ALREADY FINISHED',
  NOT_WIRED: 'LIVE RUN NOT CONNECTED',
  REFUSED: 'RUN NOT STARTED',
};

/**
 * Refusals worth offering a retry for. An unreadable gate can be readable a
 * moment later and a judge that did not answer can answer on a second ask; a
 * spent allowance cannot change, and a button that only ever fails is a worse
 * answer than no button.
 *
 * `RESULT_INVALID` is deliberately NOT retryable: the trace that failed
 * validation is the trace that would be sent again.
 */
const RETRYABLE: readonly LiveRunRefusalCode[] = [
  'GATE_UNAVAILABLE',
  'DETECTION_FAILED',
  'INVALID_REQUEST',
  'RUN_NOT_FOUND',
  'REFUSED',
];

/**
 * The run this console is showing. A run it issued carries the token; a run it
 * reopened by id carries `null` there, because no read can hand the token back.
 */
type ActiveRun = Omit<LiveRunTicketView, 'token'> & { readonly token: string | null };

const fromReattach = (view: LiveRunReattachView): ActiveRun => ({
  runId: view.runId,
  endpoint: view.endpoint,
  token: null,
  expiresAt: view.expiresAt,
  category: view.category,
  kind: view.kind,
  taskGoal: view.taskGoal,
  promptName: view.promptName,
});

/** The production clock for the expiry check. See the `now` prop. */
const systemNow = (): Date => new Date();

/** What each observed phase means, in the words a person would use. */
const PHASE_LABELS: Record<LiveRunPhase, string> = {
  waiting: 'AWAITING AGENT',
  connected: 'AGENT CONNECTED',
  finished: 'RUN FINISHED',
};

/**
 * The sentence for a reading.
 *
 * `connected` splits on `toolCalls` rather than on a phase the server does not
 * report: "your agent is here" and "your agent has done something" are different
 * facts, and the second one is a real counter, not an invented phase.
 */
function phaseLine(status: LiveRunStatusView, saved: boolean | null): string {
  if (status.phase === 'waiting') {
    return 'No agent has connected yet. Nothing is recorded until one does.';
  }
  if (status.phase === 'finished') {
    // `saved` is what we actually know about the result. A run can be ended with
    // nothing saved (it was closed unjudged, or the judge did not answer after
    // the run was claimed), and telling that reader "the replay has the whole
    // trace" would point them at a page that does not exist.
    if (saved === false) {
      return 'This run is ended. It was closed without a saved result, so it has no replay.';
    }
    return saved === true
      ? 'This run is ended, judged and saved. The replay has the whole trace.'
      : 'This run is ended.';
  }
  return status.toolCalls === 0
    ? 'Your agent has reached the endpoint but has not called a tool yet.'
    : 'Your agent is calling tools, and every call it makes is being recorded.';
}

export function LiveRunConsole({
  port = notWiredLiveRunPort,
  category,
  kind = 'malicious',
  signedIn,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  now = systemNow,
  reattachRunId,
  onRunChange,
}: {
  /**
   * A run to reopen by id, when this console has none of its own. It comes from
   * the URL, so it is the one thing that survives a reload.
   */
  reattachRunId?: string;
  /**
   * Told the id of the run this console is now showing, or `null` when it lets
   * one go. The screen mirrors it into the URL. Only the id is ever reported.
   */
  onRunChange?: (runId: string | null) => void;
  port?: ConnectLiveRunPort;
  category: Category;
  /**
   * Which framing this run serves: the attack, or its tool-parity control. The
   * default mirrors the pipeline's own (`src/runs/live-run.ts`), so a console
   * rendered without one behaves exactly as it did before the control existed.
   */
  kind?: VariantKind;
  signedIn: boolean;
  pollIntervalMs?: number;
  /**
   * The clock the expiry check reads. Injected so a test can stand on either
   * side of a ticket's expiry without waiting for it; production reads the real
   * one. It is only ever called from the poll, never during render.
   */
  now?: () => Date;
}) {
  const [run, setRun] = useState<ActiveRun | null>(null);
  // How the last reattach for a given id came out. Keyed by the id it was for,
  // so "still reading" is simply "no outcome for this id yet" and needs no flag
  // of its own.
  const [reattachOutcome, setReattachOutcome] = useState<{
    readonly runId: string;
    readonly refusal: LiveRunRefusal | null;
  } | null>(null);
  // A run the user let go of (ISSUE A FRESH RUN). It is not reopened again.
  const [releasedRunId, setReleasedRunId] = useState<string | null>(null);
  // Where the finished run's saved result lives. `undefined` is "not looked up",
  // `null` is "looked up, and nothing was saved".
  const [storedRunId, setStoredRunId] = useState<string | null | undefined>(undefined);
  // Whether that lookup has been made for this run. A lookup that FAILED leaves
  // the answer unknown, and unknown must not be drawn as "nothing was saved".
  const [resultAsked, setResultAsked] = useState(false);
  // Whether the wall clock has passed the ticket's expiry, as of the last poll.
  // Without this a run that quietly timed out reads AWAITING AGENT for ever.
  const [expired, setExpired] = useState(false);
  const [refusal, setRefusal] = useState<LiveRunRefusal | null>(null);
  const [status, setStatus] = useState<LiveRunStatusView | null>(null);
  const [statusRefusal, setStatusRefusal] = useState<LiveRunRefusal | null>(null);
  const [summary, setSummary] = useState<LiveRunSummaryView | null>(null);
  const [finishRefusal, setFinishRefusal] = useState<LiveRunRefusal | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const issue = useCallback(async () => {
    setIssuing(true);
    setRefusal(null);
    const answer = await port.start({ category, kind });
    setIssuing(false);
    if (answer.ok) {
      setRun(answer.value);
      onRunChange?.(answer.value.runId);
      return;
    }
    setRefusal(answer.refusal);
  }, [port, category, kind, onRunChange]);

  const runId = run?.runId ?? null;
  const expiresAt = run?.expiresAt ?? null;
  const done = summary !== null || status?.phase === 'finished';

  // REATTACH. A console with no run of its own, handed an id, asks for that run
  // back. Signed-out visitors ask for nothing: the gate is all they are shown.
  const wantsReattach =
    signedIn &&
    run === null &&
    reattachRunId !== undefined &&
    reattachRunId !== releasedRunId &&
    reattachOutcome?.runId !== reattachRunId;

  useEffect(() => {
    if (!wantsReattach || reattachRunId === undefined) return;
    let live = true;
    void (async () => {
      const answer = await port.reattach({ runId: reattachRunId });
      if (!live) return;
      if (answer.ok) {
        setRun(fromReattach(answer.value));
        if (answer.value.finishedAt !== null) setStoredRunId(answer.value.storedRunId);
        setReattachOutcome({ runId: reattachRunId, refusal: null });
        return;
      }
      setReattachOutcome({ runId: reattachRunId, refusal: answer.refusal });
    })();
    return () => {
      live = false;
    };
  }, [port, wantsReattach, reattachRunId]);

  // A run that turns out to be finished, with no summary in hand (it was ended
  // elsewhere, or before this page was opened), is asked once where its saved
  // result lives. That is the only way a reopened screen can link to the replay.
  const finishedElsewhere = status?.phase === 'finished' && summary === null;
  useEffect(() => {
    if (runId === null || !finishedElsewhere || storedRunId !== undefined || resultAsked) return;
    let live = true;
    void (async () => {
      const answer = await port.reattach({ runId });
      if (!live) return;
      setResultAsked(true);
      if (answer.ok) setStoredRunId(answer.value.storedRunId);
    })();
    return () => {
      live = false;
    };
  }, [port, runId, finishedElsewhere, storedRunId, resultAsked]);

  /** Let this run go and return to the issue control. Nothing is ended. */
  const release = useCallback(() => {
    if (runId !== null) setReleasedRunId(runId);
    setRun(null);
    setStatus(null);
    setStatusRefusal(null);
    setSummary(null);
    setFinishRefusal(null);
    setStoredRunId(undefined);
    setResultAsked(false);
    setExpired(false);
    onRunChange?.(null);
  }, [runId, onRunChange]);

  const finish = useCallback(async () => {
    // Guarded rather than disabled: a control that goes grey reads like a control
    // that might never come back, and this screen deliberately has no disabled
    // elements at all. A second click while one is in flight is simply ignored.
    if (runId === null || finishing) return;
    setFinishing(true);
    setFinishRefusal(null);
    const answer = await port.finish({ runId });
    setFinishing(false);
    if (answer.ok) {
      setSummary(answer.value);
      return;
    }
    setFinishRefusal(answer.refusal);
  }, [port, runId, finishing]);

  // REAL STATE, ON A REAL READ. The first read happens the moment a run exists,
  // and the polling stops the moment the run is over — there is nothing further
  // to observe and a timer that never stops is a leak.
  useEffect(() => {
    if (runId === null || done) return;
    let live = true;
    const read = async () => {
      const answer = await port.readState({ runId });
      if (!live) return;
      // An unparseable expiry compares false, so a malformed value can never
      // declare a live run dead.
      if (expiresAt !== null) setExpired(now().getTime() >= Date.parse(expiresAt));
      if (answer.ok) {
        setStatus(answer.value);
        setStatusRefusal(null);
      } else {
        setStatusRefusal(answer.refusal);
      }
    };
    void read();
    const timer = setInterval(() => void read(), pollIntervalMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [port, runId, done, pollIntervalMs, now, expiresAt]);

  if (!signedIn) return <SignInGate />;
  if (refusal !== null) return <Refusal refusal={refusal} onRetry={issue} />;
  if (run === null) {
    if (wantsReattach) return <Reopening />;
    const reattachRefusal =
      reattachOutcome !== null && reattachOutcome.runId === reattachRunId
        ? reattachOutcome.refusal
        : null;
    return (
      <div className="flex flex-col gap-5">
        {reattachRefusal !== null && <ReattachRefused refusal={reattachRefusal} />}
        <BeforeIssue onIssue={issue} issuing={issuing} kind={kind} />
      </div>
    );
  }

  const reattached = run.token === null;
  // What we know about the saved result: the finish answer if this page got it,
  // otherwise what the lookup found.
  const replayRunId = summary !== null ? summary.storedRunId : storedRunId;

  // The one piece of motion on this screen: the issued run eases in, once,
  // because the user just asked for it. Transform and opacity only, and
  // `prefers-reduced-motion` resolves it to the resting state (globals.css).
  return (
    <div className="panel-in flex flex-col gap-6">
      <Endpoint run={run} />
      {/* THE HOW. The three sections around it say what the run is, what the
          agent's job is and what we have seen; this one is the only place that
          says what the reader has to DO, so it sits immediately after the values
          it is built from and before the goal that depends on the connection. */}
      {/* The setup commands embed the token, so a reopened run has none to
          show. Drawing them with a placeholder would be a command that cannot
          work, which is worse than no command. */}
      {run.token !== null && <ClientSetup ticket={{ ...run, token: run.token }} />}
      <TaskGoal run={run} />
      <Connection
        expiresAt={run.expiresAt}
        expired={expired}
        reattached={reattached}
        replayRunId={replayRunId}
        onRelease={release}
        status={status}
        statusRefusal={statusRefusal}
        summary={summary}
        finishRefusal={finishRefusal}
        finishing={finishing}
        onFinish={finish}
      />
    </div>
  );
}

// ── Signed out ──

function SignInGate() {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-caution/40 bg-caution/5 px-5 py-4">
      <div className="min-w-[220px] flex-1">
        <p className="micro-label text-caution">SIGN IN TO RUN LIVE</p>
        <p className="reading mt-1.5">
          A live run hosts an endpoint for your account and spends operator budget on the judge, so
          it needs an account. Sample playback needs no sign-in and no key.
        </p>
      </div>
      <Link
        href="/sign-in"
        className="min-h-11 shrink-0 rounded-md border border-line-em bg-nominal/5 px-5 py-2.5 font-mono text-[13px] leading-6 tracking-[0.08em] text-nominal transition-colors hover:bg-nominal/10"
      >
        SIGN IN
      </Link>
    </div>
  );
}

// ── Before anything is issued ──

function BeforeIssue({
  onIssue,
  issuing,
  kind,
}: {
  onIssue: () => void;
  issuing: boolean;
  kind: VariantKind;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* WHAT THIS RUN IS, in the framing the user actually picked. The tools are
          identical either way; what changes is whether an attack is staged on
          them, and saying "the attack surface" for a control run would be the one
          sentence on this panel that was not true. */}
      <p className="reading max-w-[68ch]">
        {kind === 'benign'
          ? 'You point your agent at an endpoint we host. We serve the same tool surface for the ' +
            'category you picked with no attack staged on it, and we record every tool call your ' +
            'agent chooses to make.'
          : 'You point your agent at an endpoint we host. We serve the attack surface for the ' +
            'category you picked, and we record every tool call your agent chooses to make.'}
      </p>
      <p className="reading max-w-[68ch] text-ink-muted">
        We never ask you for an endpoint or a key, because we never call out to anything. Everything
        our endpoint serves is fabricated attack content in a sandbox, and nothing real sits behind
        it.
      </p>
      <div>
        <button
          type="button"
          onClick={onIssue}
          className="inline-flex min-h-11 items-center gap-2.5 rounded-md border border-nominal bg-nominal/10 px-5 py-3 font-mono text-[14px] tracking-[0.08em] text-readout shadow-glow-nominal transition-colors hover:bg-nominal/20"
        >
          {issuing ? 'ISSUING' : 'ISSUE RUN ENDPOINT'}
        </button>
      </div>
    </div>
  );
}

// ── Reattach in flight, and reattach refused ──

function Reopening() {
  return (
    <div className="rounded-lg border border-line bg-panel/60 px-5 py-4">
      <p className="micro-label" style={{ color: 'var(--status-inert)' }}>
        REOPENING RUN
      </p>
      <p className="reading mt-1.5 max-w-[68ch]">We are reading this run back from the server.</p>
    </div>
  );
}

function ReattachRefused({ refusal }: { refusal: LiveRunRefusal }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-caution/40 bg-caution/5 px-5 py-4">
      <p className="micro-label text-caution">{REFUSAL_HEADINGS[refusal.code]}</p>
      <p className="reading max-w-[68ch]">{refusal.message}</p>
      <p className="reading max-w-[68ch] text-ink-muted">
        Nothing was reopened. A run can only be reopened by the account that issued it, and only
        until it is swept after it expires. You can issue a new run below.
      </p>
    </div>
  );
}

// ── The issued run ──

function Endpoint({ run }: { run: ActiveRun }) {
  return (
    <section aria-labelledby="connect-endpoint" className="flex flex-col gap-3">
      <h3 id="connect-endpoint" className="reading-h3">
        Point your agent here.
      </h3>
      <CopyOut label="RUN ENDPOINT" name="run endpoint" value={run.endpoint} />
      {run.token !== null ? (
        <>
          <CopyOut label="RUN TOKEN" name="run token" value={run.token} secret />
          <p className="reading max-w-[68ch] text-ink-muted">
            The token is shown once and we cannot show it again, because we store only a hash of it.
            It travels as an Authorization header on every request your agent makes, and the
            commands below set that up for you. It opens this one run, on this one account, and it
            dies when the run ends or when it expires.
          </p>
        </>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel/60 px-5 py-4">
          <p className="micro-label" style={{ color: 'var(--status-inert)' }}>
            RUN REOPENED · TOKEN NOT SHOWN
          </p>
          <p className="reading max-w-[68ch]">
            This run was reopened from its saved state. Its token was shown once, when the run was
            issued, and we cannot show it again, because we store only a hash of it. An agent that
            already holds the token keeps working, and you can watch the run and end it from here.
          </p>
        </div>
      )}
      {/* WHAT THIS TICKET IS, read off the ticket the server issued rather than
          off the picker: a user who issues several in a session has to be able to
          tell them apart, and the framing is the one thing two tickets for the
          same category differ by. Evidence, so it is printed as read and never
          counted up or animated. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="instrument-faint">
          SERVING <span className="readout">{run.category}</span>
        </span>
        <span className="instrument-faint">
          RUN TYPE <span className="readout">{RUN_TYPE_LABEL[run.kind]}</span>
        </span>
        <span className="instrument-faint">
          EXPIRES <span className="readout">{run.expiresAt}</span>
        </span>
      </div>
      <p className="reading max-w-[68ch] text-ink-muted">
        The tools on this endpoint are hostile by design. A leaked token is worth one sandboxed run
        of invented content, never an account.
      </p>
    </section>
  );
}

function TaskGoal({ run }: { run: ActiveRun }) {
  return (
    <section
      aria-labelledby="connect-goal"
      className="flex flex-col gap-3 border-t border-line pt-6"
    >
      <h3 id="connect-goal" className="reading-h3">
        Give your agent its task.
      </h3>
      <p className="reading max-w-[68ch]">
        MCP has no message that lets a server tell an agent what its job is, so the goal has to
        reach your agent another way. There are two, and the first is better because the goal never
        leaves the protocol.
      </p>
      <div className="rounded-lg border border-line-em bg-nominal/5 px-4 py-3.5">
        <p className="micro-label mb-2">PREFERRED · PUBLISHED MCP PROMPT</p>
        <p className="reading max-w-[68ch]">
          Our endpoint publishes the goal as a prompt. If your client supports prompts, list them on
          the connection you just made and fetch this one.
        </p>
        <p className="readout mt-2.5">{run.promptName}</p>
      </div>
      <div className="flex flex-col gap-2.5">
        <p className="reading max-w-[68ch]">
          If your client does not support prompts, paste this into your agent instead. It is the
          same text the prompt serves.
        </p>
        <CopyOut label="TASK GOAL" name="task goal" value={run.taskGoal} tone="prose" />
      </div>
    </section>
  );
}

// ── Real connection state ──

function Connection({
  expiresAt,
  expired,
  reattached,
  replayRunId,
  onRelease,
  status,
  statusRefusal,
  summary,
  finishRefusal,
  finishing,
  onFinish,
}: {
  /** The ticket's expiry, printed as issued. Evidence, never reformatted. */
  expiresAt: string;
  /** Whether the clock had passed that expiry at the last poll. */
  expired: boolean;
  /** Whether this run was reopened by id, and so has no token on this page. */
  reattached: boolean;
  /**
   * The saved result's row id. `undefined` is "not known yet", `null` is "the
   * run ended with nothing saved".
   */
  replayRunId: string | null | undefined;
  /** Let this run go and return to the issue control. */
  onRelease: () => void;
  status: LiveRunStatusView | null;
  statusRefusal: LiveRunRefusal | null;
  summary: LiveRunSummaryView | null;
  finishRefusal: LiveRunRefusal | null;
  finishing: boolean;
  onFinish: () => void;
}) {
  const phase: LiveRunPhase | null = summary !== null ? 'finished' : (status?.phase ?? null);
  // AWAITING is the neutral fourth state, not a warning and never a breach: we
  // have observed something real, and what we observed is "nothing has happened".
  // A run that passed its expiry before finishing is dead, and says so. It is
  // the same neutral fourth state as AWAITING, never red: nothing was breached,
  // the window simply closed. A FINISHED run stays finished however old it is.
  const lapsed = expired && phase !== 'finished';
  const live = !lapsed && (phase === 'connected' || phase === 'finished');
  // The run can only be ended once the agent has actually turned up. Ending a run
  // nobody connected to would spend a judge call on a trace with no agent in it.
  const canFinish = phase === 'connected' && summary === null;
  // A reopened run that no agent has reached has no way forward on this page:
  // the token it needs was shown once and is gone. Say so and offer the one
  // thing that works. A connected run is never offered this, it is still live.
  const stranded = reattached && phase === 'waiting';
  const saved = replayRunId === undefined ? null : replayRunId !== null;

  return (
    <section
      aria-labelledby="connect-state"
      className="flex flex-col gap-3 border-t border-line pt-6"
    >
      <h3 id="connect-state" className="reading-h3">
        What we have actually seen.
      </h3>
      <div className="rounded-lg border border-line bg-panel/60 px-5 py-4" role="status">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span
            aria-hidden="true"
            className={cn('h-2.5 w-2.5 rounded-full', live && 'bg-nominal shadow-glow-nominal')}
            style={live ? undefined : { background: 'var(--status-inert)' }}
          />
          <span
            className="font-mono text-[13px] tracking-[0.08em]"
            style={live ? undefined : { color: 'var(--status-inert)' }}
          >
            {lapsed ? 'RUN EXPIRED' : phase === null ? 'READING RUN STATE' : PHASE_LABELS[phase]}
          </span>
          {status !== null && (
            <span className="ml-auto flex items-baseline gap-2">
              {/* Evidence, and the RIGHT evidence. This is what the agent chose
                  to do, not the size of the trace. Printed as read, never
                  counted up or animated. */}
              <span className="display-md">{status.toolCalls}</span>
              <span className="instrument-faint">tool calls</span>
            </span>
          )}
        </div>
        <p className="reading mt-3 max-w-[68ch]">
          {lapsed
            ? 'This run passed its expiry before it finished, so its endpoint and token no longer ' +
              'accept connections. Issue a new run to try again.'
            : status === null
              ? 'We are reading the state of this run from the server.'
              : phaseLine(status, saved)}
        </p>
        {!lapsed && phase === 'waiting' && !reattached && (
          <p className="reading mt-2 max-w-[68ch] text-ink-muted">
            This reading changes to AGENT CONNECTED the moment your agent reaches the endpoint. If
            it is still AWAITING AGENT after you have started your client, the connection did not
            take.
          </p>
        )}
        {status !== null && (
          <p className="reading mt-2 max-w-[68ch] text-ink-muted">
            The trace holds {status.steps} steps in total, which counts the task goal we sent and
            the completion step we infer, as well as your agent{"'"}s own.
          </p>
        )}
        {statusRefusal !== null && (
          <p className="reading mt-2 max-w-[68ch] text-ink-muted">{statusRefusal.message}</p>
        )}
        {/* When the run stops accepting connections, and, when the server records
            one, when the agent was last seen. Both are evidence, printed as issued
            and never counted down or animated.

            LAST SEEN is shown only when a time was actually reported. It used to
            fall back to the word "never", which sat beside AGENT CONNECTED and a
            tool-call count on a live run and was simply false. No durable
            timestamp exists yet (`last_seen_at` on `live_runs` is deferred to
            v2), so until then the reading is omitted rather than invented. */}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
          {status !== null && status.lastSeenAt !== null && (
            <p className="instrument-faint">
              LAST SEEN <span className="readout">{status.lastSeenAt}</span>
            </p>
          )}
          <p className="instrument-faint">
            {lapsed ? 'EXPIRED' : 'EXPIRES'} <span className="readout">{expiresAt}</span>
          </p>
        </div>
        {finishRefusal !== null && (
          <div className="mt-4 flex flex-col gap-2 rounded-md border border-caution/40 bg-caution/5 px-4 py-3">
            <p className="micro-label text-caution">{REFUSAL_HEADINGS[finishRefusal.code]}</p>
            <p className="reading max-w-[68ch]">{finishRefusal.message}</p>
          </div>
        )}
      </div>
      <p className="reading max-w-[68ch] text-ink-muted">
        We record what your agent does, not what it thinks. Reasoning is not observable from this
        side of the connection and is never invented, so a live trace carries fewer steps than the
        constructed sample does.
      </p>
      {canFinish && (
        <div className="flex flex-col gap-2.5">
          <p className="reading max-w-[68ch]">
            When your agent is done, end the run. That revokes the token, asks the fixed judge for a
            verdict on what was recorded, and saves the result. A compromise comes back anchored to
            one step; a clean run comes back as a clean run. Both are saved and both are results.
          </p>
          <div>
            <button
              type="button"
              onClick={onFinish}
              className="inline-flex min-h-11 items-center gap-2.5 rounded-md border border-nominal bg-nominal/10 px-5 py-3 font-mono text-[14px] tracking-[0.08em] text-readout shadow-glow-nominal transition-colors hover:bg-nominal/20"
            >
              {finishing ? 'JUDGING' : 'END RUN AND JUDGE'}
            </button>
          </div>
        </div>
      )}
      {stranded && (
        <div className="flex flex-col gap-2.5">
          <p className="reading max-w-[68ch]">
            This run was reopened without its token, and no agent has connected to it. If your
            client was not set up before this page was reloaded, the run cannot be registered with a
            client now, because we cannot show the token again. Issue a fresh run to get a new
            endpoint and token. This one is left to expire.
          </p>
          <div>
            <button
              type="button"
              onClick={onRelease}
              className="inline-flex min-h-11 items-center gap-2.5 rounded-md border border-line-em px-5 py-3 font-mono text-[14px] tracking-[0.08em] text-ink transition-colors hover:border-nominal hover:text-readout"
            >
              ISSUE A FRESH RUN
            </button>
          </div>
        </div>
      )}
      {typeof replayRunId === 'string' && (
        <div>
          <Link
            href={`/runs/${replayRunId}`}
            className="inline-flex min-h-11 items-center gap-2.5 rounded-md border border-nominal bg-nominal/10 px-5 py-3 font-mono text-[14px] leading-6 tracking-[0.08em] text-readout shadow-glow-nominal transition-colors hover:bg-nominal/20"
          >
            OPEN THE REPLAY
          </Link>
        </div>
      )}
    </section>
  );
}

// ── Refusal ──

function Refusal({ refusal, onRetry }: { refusal: LiveRunRefusal; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div
        role="status"
        className="flex flex-col gap-2 rounded-lg border border-caution/40 bg-caution/5 px-5 py-4"
      >
        <p className="micro-label text-caution">{REFUSAL_HEADINGS[refusal.code]}</p>
        <p className="reading max-w-[68ch]">{refusal.message}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Link
          href="/runs/sample"
          className="inline-flex min-h-11 items-center gap-2.5 rounded-md border border-line-em px-5 py-3 font-mono text-[14px] leading-6 tracking-[0.08em] text-ink transition-colors hover:border-nominal hover:text-readout"
        >
          WATCH THE SAMPLE RUN
        </Link>
        {RETRYABLE.includes(refusal.code) && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center gap-2.5 rounded-md border border-line px-5 py-3 font-mono text-[14px] tracking-[0.08em] text-ink-muted transition-colors hover:border-line-em hover:text-ink"
          >
            TRY AGAIN
          </button>
        )}
      </div>
    </div>
  );
}
