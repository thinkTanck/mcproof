import { z } from 'zod';
import { CategorySchema, type RunResult } from '@/contract';

/**
 * A persisted run: a live `RunResult` plus its ownership + timestamp. The row
 * `id` is a fresh uuid (the RunResult's own `runId` is `model::category` and is
 * NOT unique per user over time), so a user can accumulate many runs.
 */
export interface StoredRun {
  /** Unique row id (uuid) — the address a run is fetched/linked by. */
  readonly id: string;
  /** Owner (Supabase auth user id). */
  readonly userId: string;
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;
  readonly run: RunResult;
}

/**
 * WHAT IS STORED FOR A RUN ITS OWNER DISCARDED
 * ([ADR-0013](../../docs/adr/0013-a-discarded-run-is-stored-unjudged.md)).
 *
 * A discarded run was ended on purpose without asking the judge, so it has no
 * verdict, and it is not a `RunResult`: that contract requires one. Inventing a
 * verdict to make it fit would put a `compromised` ruling nobody made into the
 * one table every result screen reads. So it is its OWN shape, in the same
 * `run` column, told apart by `discarded: true`.
 *
 * It is strict, and that is the point. There is no `verdict`, no `trace` and no
 * `rationale` key to fill in, so a discarded row cannot be given a ruling even
 * by accident, and `RunResultSchema` (which demands a verdict) cannot parse one.
 * The two shapes cannot be read as each other in either direction.
 *
 * It carries no trace on purpose. Nothing renders a discarded run's steps, and
 * the reason to discard is that the run was not a test, so its steps are not
 * evidence of anything. What is kept is what a list needs to name the row.
 *
 * The row still EXISTS, which is what makes the lifetime allowance count it:
 * `countRunsSince` counts rows, whatever their shape.
 */
export const DiscardedRunSchema = z
  .object({
    /** The marker. Always `true`; a row without it is not a discarded run. */
    discarded: z.literal(true),
    /** The hosted run id, the one the MCP endpoint was served at. */
    runId: z.string().min(1),
    /** The class we staged. Never a judge's classification: there was no judge. */
    category: CategorySchema,
    /** The client's own claimed name, as the trace recorded it. */
    model: z.string(),
    /** Observable steps recorded when the run was discarded. */
    steps: z.number().int().nonnegative(),
    /** Tool calls among them. */
    toolCalls: z.number().int().nonnegative(),
    /** ISO-8601 of the discard. */
    discardedAt: z.string().min(1),
  })
  .strict();

export type DiscardedRun = z.infer<typeof DiscardedRunSchema>;

/** A persisted discarded run: the marker plus its ownership and timestamp. */
export interface StoredDiscardedRun {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly discarded: DiscardedRun;
}

/**
 * Whether a stored `run` payload is the discarded marker rather than a result.
 * Deliberately loose: it only ROUTES a row to the right parser, and the parser
 * (`DiscardedRunSchema` or `RunResultSchema`) is what validates it.
 */
export function isDiscardedPayload(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { discarded?: unknown }).discarded === true
  );
}

/**
 * Persistence port for a user's live runs (Slice 1). Every method is scoped to a
 * `userId`: a run is only ever readable by its owner. Two adapters satisfy it —
 * an in-memory one (tests / offline) and a Supabase one (prod, where Row-Level
 * Security enforces the same ownership at the database). The public sample/
 * fixture data keeps flowing through the separate `DataSource`.
 *
 * TWO KINDS OF ROW, AND WHICH READ SEES WHICH. A row is either a judged
 * `RunResult` or a discarded marker ({@link DiscardedRunSchema}). Every read on
 * THIS port means "a judged result" and never returns a discarded row, so the
 * replay, the report and the leaderboard cannot be handed one. The markers are
 * read through their own port, {@link DiscardedRunStore}. `countRunsSince`
 * counts BOTH kinds, because the allowance is spent by starting a run and a
 * discard does not hand it back.
 */
export interface RunRepository {
  /** Persist a run for a user; returns the stored row (with its new id). */
  saveRun(userId: string, run: RunResult): Promise<StoredRun>;
  /** Fetch one of the user's runs by row id, or null (also null if owned by another user). */
  getRun(userId: string, id: string): Promise<StoredRun | null>;
  /**
   * The user's saved run whose OWN `runId` is the one given, or null.
   *
   * A live run is hosted under one id and saved under another: the row `id` is
   * minted on insert, while `run.runId` keeps the id the MCP endpoint was served
   * at. A screen that only knows the hosted id (it lost the finish response to a
   * reload) finds its saved result through this. Null is also the honest answer
   * for a run that was closed without a result: abandoned, discarded, or never
   * judged.
   */
  findByRunId(userId: string, runId: string): Promise<StoredRun | null>;
  /** All of the user's JUDGED runs, newest first. */
  listRuns(userId: string): Promise<StoredRun[]>;
  /** How many runs the user has created at or after `since` (per-account cap accounting). */
  countRunsSince(userId: string, since: Date): Promise<number>;
}

/**
 * The port for discarded runs: the same table, the same ownership rule, and a
 * SEPARATE interface on purpose. A consumer that deals in results (the replay,
 * the leaderboard, the fix report) holds a `RunRepository` and has no method on
 * it that could hand it a run with no verdict. Only the few places that need to
 * know a run was discarded hold this one. Both adapters implement both ports.
 */
export interface DiscardedRunStore {
  /** Persist the marker for a run its owner discarded. No verdict is involved. */
  saveDiscardedRun(userId: string, discarded: DiscardedRun): Promise<StoredDiscardedRun>;
  /** One of the user's discarded runs by row id, or null (also null for another user). */
  getDiscardedRun(userId: string, id: string): Promise<StoredDiscardedRun | null>;
  /** The user's discarded run with this hosted run id, or null. */
  findDiscardedByRunId(userId: string, runId: string): Promise<StoredDiscardedRun | null>;
  /** All of the user's discarded runs, newest first. */
  listDiscardedRuns(userId: string): Promise<StoredDiscardedRun[]>;
}

const newestFirst = (a: { createdAt: string }, b: { createdAt: string }): number =>
  b.createdAt.localeCompare(a.createdAt);

/**
 * In-memory `RunRepository` — the offline/test adapter. Ownership is enforced in
 * code the way RLS enforces it in Postgres, so the same isolation is exercised in
 * units.
 */
export class InMemoryRunRepository implements RunRepository, DiscardedRunStore {
  private rows: StoredRun[] = [];
  private gone: StoredDiscardedRun[] = [];

  async saveRun(userId: string, run: RunResult): Promise<StoredRun> {
    const stored: StoredRun = {
      id: crypto.randomUUID(),
      userId,
      createdAt: new Date().toISOString(),
      run,
    };
    this.rows.push(stored);
    return stored;
  }

  async getRun(userId: string, id: string): Promise<StoredRun | null> {
    return this.rows.find((r) => r.id === id && r.userId === userId) ?? null;
  }

  async findByRunId(userId: string, runId: string): Promise<StoredRun | null> {
    const hits = this.rows
      .filter((r) => r.userId === userId && r.run.runId === runId)
      .sort(newestFirst);
    return hits[0] ?? null;
  }

  async listRuns(userId: string): Promise<StoredRun[]> {
    return this.rows.filter((r) => r.userId === userId).sort(newestFirst);
  }

  async countRunsSince(userId: string, since: Date): Promise<number> {
    const t = since.toISOString();
    // Both kinds of row: one table in production, and a discard is still a run
    // the account started.
    return [...this.rows, ...this.gone].filter((r) => r.userId === userId && r.createdAt >= t)
      .length;
  }

  async saveDiscardedRun(userId: string, discarded: DiscardedRun): Promise<StoredDiscardedRun> {
    const stored: StoredDiscardedRun = {
      id: crypto.randomUUID(),
      userId,
      createdAt: new Date().toISOString(),
      discarded: DiscardedRunSchema.parse(discarded),
    };
    this.gone.push(stored);
    return stored;
  }

  async getDiscardedRun(userId: string, id: string): Promise<StoredDiscardedRun | null> {
    return this.gone.find((r) => r.id === id && r.userId === userId) ?? null;
  }

  async findDiscardedByRunId(userId: string, runId: string): Promise<StoredDiscardedRun | null> {
    const hits = this.gone
      .filter((r) => r.userId === userId && r.discarded.runId === runId)
      .sort(newestFirst);
    return hits[0] ?? null;
  }

  async listDiscardedRuns(userId: string): Promise<StoredDiscardedRun[]> {
    return this.gone.filter((r) => r.userId === userId).sort(newestFirst);
  }
}
