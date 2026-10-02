import type { SupabaseClient } from '@supabase/supabase-js';
import { RunResultSchema, type RunResult } from '@/contract';
import type { RunRepository, StoredRun } from './run-repository';

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

/**
 * Supabase-backed `RunRepository`. Constructed with a supabase-js client that
 * carries the caller's identity, so **Row-Level Security enforces ownership at
 * the database** — the `userId` argument sets `user_id` on insert (which RLS
 * checks against auth.uid()) and narrows reads defensively. Only observable data
 * is written (the RunResult holds no BYOK key).
 */
export class SupabaseRunRepository implements RunRepository {
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

  async getRun(userId: string, id: string): Promise<StoredRun | null> {
    const { data, error } = await this.client
      .from('runs')
      .select(COLS)
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`getRun failed: ${error.message}`);
    return data ? toStored(data as RunRow) : null;
  }

  async findByRunId(userId: string, runId: string): Promise<StoredRun | null> {
    // `run->>runId` reads the hosted run id out of the stored result. Newest
    // first and one row, so a read can never fail on an unexpected duplicate.
    const { data, error } = await this.client
      .from('runs')
      .select(COLS)
      .eq('user_id', userId)
      .eq('run->>runId', runId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`findByRunId failed: ${error.message}`);
    return data ? toStored(data as RunRow) : null;
  }

  async listRuns(userId: string): Promise<StoredRun[]> {
    const { data, error } = await this.client
      .from('runs')
      .select(COLS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`listRuns failed: ${error.message}`);
    return (data as RunRow[]).map(toStored);
  }

  async countRunsSince(userId: string, since: Date): Promise<number> {
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
}
