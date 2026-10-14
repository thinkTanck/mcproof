import { getSupabaseConfig } from '@/config/env';
import { createServerSupabase } from '@/lib/supabase/server';
import { InMemoryRunRepository, type DiscardedRunReader } from './run-repository';
import { SupabaseRunReader } from './run-repository.supabase';

/**
 * Resolve the READS of DISCARDED runs
 * ([ADR-0013](../../docs/adr/0013-a-discarded-run-is-stored-unjudged.md)).
 *
 * The same resolution `getRunRepository()` makes, and for the same reasons: the
 * Supabase reader, RLS-scoped to the caller's cookie session, when auth is
 * configured, and the always-empty in-memory adapter otherwise. Server-only.
 *
 * It is the same table and the same adapter class. It is a separate accessor
 * because it is a separate PORT: what comes back has only the discarded-run
 * reads on it, so a caller here cannot reach for a judged result by mistake,
 * and a caller of `getRunRepository()` cannot be handed a run with no verdict.
 *
 * Read-only, like its sibling: the marker is WRITTEN by
 * `src/runs/run-writes.ts` on the service-role client.
 */
export async function getDiscardedRunStore(): Promise<DiscardedRunReader> {
  const supabase = getSupabaseConfig() ? await createServerSupabase() : null;
  return supabase ? new SupabaseRunReader(supabase) : new InMemoryRunRepository();
}
