import type { RunResult } from '@/contract';

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
 * Persistence port for a user's live runs (Slice 1). Every method is scoped to a
 * `userId`: a run is only ever readable by its owner. Two adapters satisfy it —
 * an in-memory one (tests / offline) and a Supabase one (prod, where Row-Level
 * Security enforces the same ownership at the database). The public sample/
 * fixture data keeps flowing through the separate `DataSource`.
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
   * for a run that was closed without a result: abandoned, or never judged.
   */
  findByRunId(userId: string, runId: string): Promise<StoredRun | null>;
  /** All of the user's runs, newest first. */
  listRuns(userId: string): Promise<StoredRun[]>;
  /** How many runs the user has created at or after `since` (per-account cap accounting). */
  countRunsSince(userId: string, since: Date): Promise<number>;
}

/**
 * In-memory `RunRepository` — the offline/test adapter. Ownership is enforced in
 * code the way RLS enforces it in Postgres, so the same isolation is exercised in
 * units.
 */
export class InMemoryRunRepository implements RunRepository {
  private rows: StoredRun[] = [];

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
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return hits[0] ?? null;
  }

  async listRuns(userId: string): Promise<StoredRun[]> {
    return this.rows
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async countRunsSince(userId: string, since: Date): Promise<number> {
    const t = since.toISOString();
    return this.rows.filter((r) => r.userId === userId && r.createdAt >= t).length;
  }
}
