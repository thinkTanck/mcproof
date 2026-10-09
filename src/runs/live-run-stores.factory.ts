/**
 * Which adapter a live run's stores use — decided the same way
 * `getRunRepository()` decides it, and for the same reason.
 *
 * THERE IS NO DRIVER SWITCH, deliberately. Selection is purely "is Supabase
 * configured", so a deployment cannot end up on the wrong store because an env
 * var was misspelt, and an offline clone still boots with no credentials at all.
 *
 * WHY THE ADMIN CLIENT, WHEN THE RUN REPOSITORY USES THE COOKIE-BOUND ONE. The
 * `runs` table has owner policies, so a user's own session is exactly the right
 * identity to read it with. These two tables have RLS on and ZERO policies, so no
 * session reaches them by design: a run token must never be re-readable by the
 * browser it was issued to, and the open-run registry is server bookkeeping the
 * agent has no business in. That leaves the service-role key, used server-side
 * only. Ownership is still checked in code — `verifyRunToken` binds the token to
 * one run AND one account, and the live-run host refuses another account's run —
 * so bypassing RLS does not mean skipping the check.
 *
 * A fresh DURABLE adapter per call, like the run repository: the state that
 * matters is in Postgres, and the client object is cheap next to the work it is
 * about to do.
 *
 * ── THE OFFLINE ADAPTERS ARE ONE PER PROCESS, AND THAT IS NOT SYMMETRY ──
 *
 * The in-memory adapters ARE their state, so building a fresh one per call would
 * hand back a store that forgets every write the moment the caller returns: a
 * token saved by `start()` would be unknown to the very next request, and a run
 * created by one call would be missing from the next. They are therefore held on
 * `globalThis`, which also keeps a dev-server hot reload from stranding a run
 * behind a second, empty store. The durable adapters need none of this, because
 * they hold nothing.
 */
import { getSupabaseConfig } from '@/config/env';
import { createAdminSupabase } from '@/lib/supabase/server';
import { InMemoryLiveRunSessionStore, type LiveRunSessionStore } from '@/runs/live-run-store';
import { SupabaseLiveRunSessionStore } from '@/runs/live-run-store.supabase';
import { InMemoryRunTokenStore, type RunTokenStore } from '@/runs/run-token';
import { SupabaseRunTokenStore } from '@/runs/run-token.supabase';

interface OfflineStores {
  tokens?: InMemoryRunTokenStore;
  sessions?: InMemoryLiveRunSessionStore;
}

const OFFLINE_KEY = Symbol.for('mcproof.offline-live-run-stores');

type OfflineHolder = { [OFFLINE_KEY]?: OfflineStores };

function offline(): OfflineStores {
  const holder = globalThis as unknown as OfflineHolder;
  holder[OFFLINE_KEY] ??= {};
  return holder[OFFLINE_KEY];
}

/** The service-role client, or null when this deployment has no Supabase. */
function adminClient() {
  return getSupabaseConfig() ? createAdminSupabase() : null;
}

/** Where per-run connection tokens are written, read and revoked. */
export function getRunTokenStore(): RunTokenStore {
  const client = adminClient();
  if (client) return new SupabaseRunTokenStore(client);
  const held = offline();
  held.tokens ??= new InMemoryRunTokenStore();
  return held.tokens;
}

/** The open-run registry: which runs exist, and what they have recorded. */
export function getLiveRunSessionStore(): LiveRunSessionStore {
  const client = adminClient();
  if (client) return new SupabaseLiveRunSessionStore(client);
  const held = offline();
  held.sessions ??= new InMemoryLiveRunSessionStore();
  return held.sessions;
}

/**
 * Drop the process-held offline stores.
 *
 * Test seam, mirroring `otpRateLimitStore.reset()` and `resetLiveRunRegistry()`:
 * the offline state is process-wide by design, so a suite that could not clear it
 * would carry one test's runs into the next. Production never calls it, and it
 * does not touch the durable adapters because they hold nothing to drop.
 */
export function resetOfflineLiveRunStores(): void {
  const holder = globalThis as unknown as OfflineHolder;
  holder[OFFLINE_KEY] = {};
}
