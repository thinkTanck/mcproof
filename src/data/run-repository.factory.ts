import { getSupabaseConfig } from '@/config/env';
import { createServerSupabase } from '@/lib/supabase/server';
import { InMemoryRunRepository, type RunReader } from './run-repository';
import { SupabaseRunReader } from './run-repository.supabase';

/**
 * Resolve the READS of a user's runs: the Supabase reader (RLS-scoped to the
 * caller's session) when auth is configured, otherwise the in-memory adapter.
 * Server-only (uses the cookie-bound client). The in-memory fallback is always
 * empty — there are no live runs without auth — so a fresh instance per call is
 * fine.
 *
 * READ-ONLY, BY TYPE AND AT RUN TIME. What comes back has no `saveRun`: a run is
 * written by `src/runs/run-writes.ts` on the service-role client, after it has
 * checked whose run it is, and by nothing that holds a browser session's
 * identity. So the database no longer has to let a signed-in user insert into
 * `public.runs` for the app to work.
 */
export async function getRunRepository(): Promise<RunReader> {
  const supabase = getSupabaseConfig() ? await createServerSupabase() : null;
  return supabase ? new SupabaseRunReader(supabase) : new InMemoryRunRepository();
}
