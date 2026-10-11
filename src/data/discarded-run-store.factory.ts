import { getSupabaseConfig } from '@/config/env';
import { createServerSupabase } from '@/lib/supabase/server';
import { InMemoryRunRepository, type DiscardedRunStore } from './run-repository';
import { SupabaseRunRepository } from './run-repository.supabase';

/**
 * Resolve the port for DISCARDED runs
 * ([ADR-0013](../../docs/adr/0013-a-discarded-run-is-stored-unjudged.md)).
 *
 * The same resolution `getRunRepository()` makes, and for the same reasons: the
 * Supabase adapter, RLS-scoped to the caller's cookie session, when auth is
 * configured, and the always-empty in-memory adapter otherwise. Server-only.
 *
 * It is the same table and the same adapter class. It is a separate accessor
 * because it is a separate PORT: what comes back has only the discarded-run
 * methods on it, so a caller here cannot reach for a judged result by mistake,
 * and a caller of `getRunRepository()` cannot be handed a run with no verdict.
 */
export async function getDiscardedRunStore(): Promise<DiscardedRunStore> {
  const supabase = getSupabaseConfig() ? await createServerSupabase() : null;
  return supabase ? new SupabaseRunRepository(supabase) : new InMemoryRunRepository();
}
