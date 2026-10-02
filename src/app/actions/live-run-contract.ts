/**
 * THE RUN-LIFECYCLE CONTRACT — the shapes the Connect screen codes against.
 *
 * It sits beside the actions rather than inside them because a `'use server'`
 * module may export nothing but async functions, so the types and the Zod
 * schemas need a home of their own. Nothing here touches the network, the
 * database or `node:` anything, so a client component can import the types
 * without dragging a server module into the browser bundle.
 *
 * ── EVERY ANSWER IS A VALUE, NEVER A THROW ──
 *
 * Each action returns {@link LiveRunActionResult}: either the value, or a typed
 * refusal whose `message` is already the sentence a screen can print. That is the
 * house pattern (`checkLiveRunAllowance`, `verifyRunToken`, `createLiveRunHost`),
 * and it is what "fail closed" means at this layer — a refused run is a state the
 * UI states plainly, never an exception surfacing as a 500 on a public route.
 *
 * The refusal codes are the pipeline's own {@link LiveRunErrorCode} plus exactly
 * one this layer adds, `NOT_SIGNED_IN`, because the pipeline is handed an account
 * id and has no way to observe that nobody is signed in. Both preflight refusals
 * (`ALLOWANCE_EXHAUSTED`, `SPEND_CAP_REACHED`) and the thrown-gate refusal
 * (`GATE_UNAVAILABLE`) are RELAYED with the gate's own sentence, never rewritten.
 */
import { z } from 'zod';
import {
  CategorySchema,
  VariantKindSchema,
  type Category,
  type Severity,
  type VariantKind,
} from '@/contract';
import type { LiveRunErrorCode } from '@/runs/live-run';

/** Why a lifecycle call could not proceed. */
export type LiveRunActionCode = LiveRunErrorCode | 'NOT_SIGNED_IN';

/** The value, or a refusal already worded for a human. */
export type LiveRunActionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: LiveRunActionCode; readonly message: string };

/** Live runs are gated on sign-in; sample playback needs no account at all. */
export const NOT_SIGNED_IN_MESSAGE =
  'Sign in to start a live run. The sample run needs no account.';

/** A request this layer could not read at all. Deliberately says nothing more. */
export const INVALID_REQUEST_MESSAGE = 'That request was not valid, so nothing was started.';

/** The one answer an unknown run and another account's run both get. */
export const RUN_NOT_FOUND_MESSAGE = 'That run was not found.';

/**
 * What `/connect` may ask for. The account is NOT a field: it is read from the
 * session on the server, so a caller cannot start a run as somebody else.
 */
export const StartLiveRunRequestSchema = z
  .object({
    category: CategorySchema,
    kind: VariantKindSchema.optional(),
    /** A label for the connecting agent. Free text, so it is bounded here. */
    model: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type StartLiveRunRequest = z.infer<typeof StartLiveRunRequestSchema>;

/**
 * Addressing one run. Bounded and trimmed because it arrives from a browser and
 * is used as a map key; the run it names is still owner-checked afterwards.
 */
export const LiveRunRefSchema = z.object({ runId: z.string().trim().min(1).max(200) }).strict();

export type LiveRunRef = z.infer<typeof LiveRunRefSchema>;

/**
 * What the user is handed to point their agent at us. The `token` is the ONLY
 * time the credential exists in full: show it once, never log it, and never try
 * to read it back (storage holds a digest and cannot produce it).
 */
export interface LiveRunTicketView {
  readonly runId: string;
  /** The per-run MCP endpoint the agent connects to. */
  readonly endpoint: string;
  /** The per-run, per-account bearer token. Shown once. */
  readonly token: string;
  /** ISO-8601 wall-clock expiry of that token. */
  readonly expiresAt: string;
  readonly category: Category;
  readonly kind: VariantKind;
  /** The goal, delivered OUT OF BAND: fetch the published prompt, or paste this. */
  readonly taskGoal: string;
  /** The name of the published MCP prompt carrying that goal. */
  readonly promptName: string;
}

/**
 * Where a run has got to, as its DURABLE ROW records it. Every phase is derived
 * from the row, so it reads the same from any instance.
 *
 * `waiting`: a token has been issued and the row shows no sign of an agent.
 * `connected`: the row has a client name (written when `initialize` is served)
 *   or the trace holds a tool call.
 * `finished`: the row has a finish time, the run was ended, judged and persisted.
 */
export type LiveRunPhase = 'waiting' | 'connected' | 'finished';

export interface LiveRunStatusView {
  readonly runId: string;
  readonly phase: LiveRunPhase;
  /**
   * ISO-8601 of the first authenticated request, or null when not recorded.
   * ALWAYS null today: nothing durable records it. It needs a `connected_at`
   * column on `live_runs`, deferred to v2. Null is "not recorded", never "never".
   */
  readonly connectedAt: string | null;
  /**
   * ISO-8601 of the most recent authenticated request, or null when not
   * recorded. ALWAYS null today, for the same reason (`last_seen_at`, v2). The
   * screen omits the reading when it is null.
   */
  readonly lastSeenAt: string | null;
  /**
   * Observable steps recorded so far. It counts the principal instruction and
   * the inferred completion step as well as the agent's own, so it is never zero
   * for a live run and it is not a count of agent activity on its own.
   */
  readonly steps: number;
  /** Tool calls the agent chose to make. THE signal a red-team run watches. */
  readonly toolCalls: number;
  /** ISO-8601 once the run has been finished, else null. */
  readonly finishedAt: string | null;
}

/**
 * What a finished run produced. Small on purpose: the full trace, verdict and fix
 * report are read from the stored run by the screens that render them.
 */
export interface LiveRunSummaryView {
  /** The run id the MCP endpoint was hosted under. */
  readonly runId: string;
  /** The persisted row id — the address the run is fetched and linked by. */
  readonly storedRunId: string;
  readonly compromised: boolean;
  /** The judge's BLIND classification, never relabelled to what we staged. */
  readonly category: Category;
  readonly severity: Severity;
  /** The offending step, present exactly when the run was compromised. */
  readonly stepId: string | null;
  /** Observable steps in the recorded trace. */
  readonly steps: number;
}
