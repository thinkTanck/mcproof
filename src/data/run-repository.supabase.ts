import type { SupabaseClient } from '@supabase/supabase-js';
import { RunResultSchema, type RunResult } from '@/contract';
import {
  DiscardedRunSchema,
  isDiscardedPayload,
  type DiscardedRun,
  type DiscardedRunStore,
  type RunRepository,
  type StoredDiscardedRun,
  type StoredRun,
} from './run-repository';

/** Row shape of `public.runs` (see supabase/migrations/0001_runs.sql). */
interface RunRow {
  id: string;
  user_id: string;
  created_at: string;
  run: unknown;
}

const COLS = 'id, user_id, created_at, run';

/** Row → StoredRun; the stored RunResult is re-validated on read (defensive). */
function toStored(row: RunRow): StoredRun {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    run: RunResultSchema.parse(row.run),
  };
}

/** Row → StoredDiscardedRun, re-validated on read like a result is. */
function toDiscarded(row: RunRow): StoredDiscardedRun {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    discarded: DiscardedRunSchema.parse(row.run),
  };
}

/**
 * Supabase-backed `RunRepository`. Constructed with a supabase-js client that
 * carries the caller's identity, so **Row-Level Security enforces ownership at
 * the database** — the `userId` argument sets `user_id` on insert (which RLS
 * checks against auth.uid()) and narrows reads defensively. Only observable data
 * is written (the RunResult holds no BYOK key).
 *
 * ONE TABLE, TWO SHAPES, NO MIGRATION. A discarded run is stored in the same
 * `run` jsonb column as a result, as the marker shape `DiscardedRunSchema`
 * describes. The column has no check constraint and the insert policy only
 * checks ownership, so nothing in the database had to change. The two kinds are
 * told apart HERE, in code, after the row is read: a row is routed by
 * `isDiscardedPayload` and then validated by the schema for its kind. That keeps
 * every query in the two forms this adapter already used against the real
 * project (`eq` on a column, `eq` on `run->>runId`), and it means a discarded row
 * can never reach `RunResultSchema.parse`, where it would throw and take a whole
 * list down with it.
 */
export class SupabaseRunRepository implements RunRepository, DiscardedRunStore {
  constructor(private readonly client: SupabaseClient) {}

  async saveRun(userId: string, run: RunResult): Promise<StoredRun> {
    const { data, error } = await this.client
      .from('runs')
      .insert({ user_id: userId, run })
      .select(COLS)
      .single();
    if (error) throw new Error(`saveRun failed: ${error.message}`);
    return toStored(data as RunRow);
  }

  /** One row by id, of either kind, scoped to its owner. */
  private async rowById(label: string, userId: string, id: string): Promise<RunRow | null> {
    const { data, error } = await this.client
      .from('runs')
      .select(COLS)
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`${label} failed: ${error.message}`);
    return (data as RunRow | null) ?? null;
  }

  /** The newest row for a hosted run id, of either kind, scoped to its owner. */
  private async rowByRunId(label: string, userId: string, runId: string): Promise<RunRow | null> {
    // `run->>runId` reads the hosted run id out of the stored payload; both
    // shapes keep it under that key. Newest first and one row, so a read can
    // never fail on an unexpected duplicate.
    const { data, error } = await this.client
      .from('runs')
      .select(COLS)
      .eq('user_id', userId)
      .eq('run->>runId', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`${label} failed: ${error.message}`);
    return (data as RunRow | null) ?? null;
  }

  /** Every row the user owns, of either kind, newest first. */
  private async rows(label: string, userId: string): Promise<RunRow[]> {
    const { data, error } = await this.client
      .from('runs')
      .select(COLS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`${label} failed: ${error.message}`);
    return data as RunRow[];
  }

  async getRun(userId: string, id: string): Promise<StoredRun | null> {
    const row = await this.rowById('getRun', userId, id);
    return row !== null && !isDiscardedPayload(row.run) ? toStored(row) : null;
  }

  async findByRunId(userId: string, runId: string): Promise<StoredRun | null> {
    const row = await this.rowByRunId('findByRunId', userId, runId);
    return row !== null && !isDiscardedPayload(row.run) ? toStored(row) : null;
  }

  async listRuns(userId: string): Promise<StoredRun[]> {
    const rows = await this.rows('listRuns', userId);
    return rows.filter((row) => !isDiscardedPayload(row.run)).map(toStored);
  }

  async countRunsSince(userId: string, since: Date): Promise<number> {
    // EVERY row, discarded ones included: the allowance is spent by starting a
    // run, and discarding one does not hand it back.
    const { count, error } = await this.client
      .from('runs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since.toISOString());
    if (error) throw new Error(`countRunsSince failed: ${error.message}`);
    // An UNKNOWN count is not a zero count. An empty table answers 0; `null`
    // means the read did not produce a number, and a HEAD request against a
    // table PostgREST cannot see returns exactly that WITH NO ERROR. The
    // allowance counts these rows, so reading it as zero would hand every
    // account its lifetime allowance back.
    if (count === null || count === undefined) {
      throw new Error('countRunsSince failed: the count came back unknown.');
    }
    return count;
  }

  async saveDiscardedRun(userId: string, discarded: DiscardedRun): Promise<StoredDiscardedRun> {
    // Validated BEFORE the insert: the schema is strict, so nothing can ride
    // along into the row, a verdict least of all.
    const marker = DiscardedRunSchema.parse(discarded);
    const { data, error } = await this.client
      .from('runs')
      .insert({ user_id: userId, run: marker })
      .select(COLS)
      .single();
    if (error) throw new Error(`saveDiscardedRun failed: ${error.message}`);
    return toDiscarded(data as RunRow);
  }

  async getDiscardedRun(userId: string, id: string): Promise<StoredDiscardedRun | null> {
    const row = await this.rowById('getDiscardedRun', userId, id);
    return row !== null && isDiscardedPayload(row.run) ? toDiscarded(row) : null;
  }

  async findDiscardedByRunId(userId: string, runId: string): Promise<StoredDiscardedRun | null> {
    const row = await this.rowByRunId('findDiscardedByRunId', userId, runId);
    return row !== null && isDiscardedPayload(row.run) ? toDiscarded(row) : null;
  }

  async listDiscardedRuns(userId: string): Promise<StoredDiscardedRun[]> {
    const rows = await this.rows('listDiscardedRuns', userId);
    return rows.filter((row) => isDiscardedPayload(row.run)).map(toDiscarded);
  }
}
