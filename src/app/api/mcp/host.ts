/**
 * THE PRODUCTION WIRING of the live-run pipeline, plus the small registry of what
 * this instance has observed about a run.
 *
 * `createLiveRunHost` (`src/runs/live-run.ts`) takes every external thing as an
 * injected port and shipped with NO production caller. This module is that
 * caller: it binds each seam to the real module the pipeline's own documentation
 * names, and nothing else. No policy is decided here.
 *
 *   preflight        -> `checkLiveRunPreflight` (the allowance + the spend cap)
 *   tokens           -> `getRunTokenStore()`, the durable per-run token store
 *   sessions         -> `getLiveRunSessionStore()`, the durable open-run registry
 *   repository       -> `getRunRepository()`, RLS-scoped to the caller's session
 *   resolveDetector  -> `resolveLiveDetector()`, the LOCKED validated judge
 *
 * ── ONE HOST PER PROCESS, AND WHAT THAT DOES AND DOES NOT MEAN NOW ──
 *
 * This module used to record a real bound: a run in progress belonged to the
 * instance that started it, because the token store and the open-run registry
 * both lived in this process. On the platform we deploy to that is a correctness
 * bug rather than a footnote — nothing pins an agent's second request to the
 * instance that served its first — and the durable adapters that fix it shipped
 * tested with no caller. This module is now that caller, so the bound is gone:
 * both stores are picked by `src/runs/live-run-stores.factory.ts`, any instance
 * can rebuild a run from its row, and the reaper reads the same registry the
 * live path writes.
 *
 * The host instance is still cached on `globalThis`, but only as a CACHE of the
 * live server objects — the same thing `createLiveRunHost` keeps its `Map` for —
 * so a dev-server hot reload does not rebuild one needlessly.
 *
 * ── THE OBSERVATION REGISTRY ──
 *
 * The endpoint notes each AUTHENTICATED inbound request here. Refused requests
 * are never noted: a stranger hammering the endpoint must not be able to make a
 * run look connected.
 *
 * THIS IS ONE INSTANCE'S MEMORY, AND THE STATUS ACTION NO LONGER READS IT. It
 * was built so the status action could answer "has the agent turned up yet",
 * and that is exactly where it failed: the action runs in a different process
 * from the route that writes here, so on the deployed platform it read an empty
 * map and a live run showed AWAITING AGENT beside three recorded tool calls
 * (2026-10-02). Status is now derived from the durable row (`getStatus` on the
 * pipeline). What is left here is a per-instance observation that nothing in
 * the app consults. The durable replacement for its timestamps is a pair of
 * columns on `live_runs` (`connected_at`, `last_seen_at`), deferred to v2, at
 * which point this registry should be deleted rather than kept alongside them.
 *
 * Nothing in this registry is a secret. It holds a run id, two timestamps and a
 * count — never a token, never a payload.
 */
import type { RunResult } from '@/contract';
import { resolveLiveDetector } from '@/detector/resolve';
import { logger } from '@/lib/logger';
import { createLiveRunHost, type LiveRunHost, type LiveRunHostDeps } from '@/runs/live-run';
import type { LiveRunSessionStore } from '@/runs/live-run-store';
import { checkLiveRunPreflight } from '@/runs/preflight';
import type { RunTokenStore } from '@/runs/run-token';

/** What this instance has seen of one run's agent. Timestamps are ISO-8601. */
export interface AgentActivity {
  /** The first authenticated request. */
  readonly connectedAt: string;
  /** The most recent authenticated request. */
  readonly lastSeenAt: string;
  /** How many authenticated requests have been served. */
  readonly requests: number;
}

interface LiveRunRegistry {
  host?: LiveRunHost;
  activity: Map<string, AgentActivity>;
  finished: Map<string, string>;
}

const REGISTRY_KEY = Symbol.for('mcpwn.live-run-registry');

type RegistryHolder = { [REGISTRY_KEY]?: LiveRunRegistry };

function registry(): LiveRunRegistry {
  const holder = globalThis as unknown as RegistryHolder;
  holder[REGISTRY_KEY] ??= { activity: new Map(), finished: new Map() };
  return holder[REGISTRY_KEY];
}

/**
 * The two durable stores, reached through a delegate that resolves the adapter on
 * every call. Two separate things are going on here and both are deliberate.
 *
 * ── WHY THE IMPORT IS INSIDE THE CALL ──
 *
 * `getRunTokenStore()` and `getLiveRunSessionStore()` reach for the SERVICE-ROLE
 * Supabase client, which lives in a module that also imports `next/headers`, and
 * this module has to stay importable by anything that only wants a type off it.
 * So the factory is imported where it is used, exactly like the repository seam
 * below. Node caches the module, so every call after the first is a lookup.
 *
 * Resolving per call is the same rule the run repository follows: which adapter
 * is right is decided by the running configuration, not by whatever was true when
 * this module happened to be imported.
 *
 * ── WHY SERVICE-ROLE AND NOT THE COOKIE-BOUND CLIENT ──
 *
 * `run_tokens`, `live_runs` and `live_run_events` have RLS enabled with ZERO
 * policies, so no browser session reaches them under any circumstances. And at
 * the two moments that matter there is no session to reach them with: a run token
 * is verified for an INBOUND agent that has no cookie of ours, and the reaper runs
 * from a scheduled request that has none either. A cookie-bound client would read
 * nothing on both paths, which would look like "no such run" rather than an error.
 *
 * Bypassing RLS does not mean skipping the check. Ownership is enforced in code:
 * `verifyRunToken` binds a token to one run AND one account, and the pipeline
 * refuses a run that does not belong to the account asking about it.
 */
const liveRunStores = () => import('@/runs/live-run-stores.factory');

const durableTokens: RunTokenStore = {
  save: async (record) => (await liveRunStores()).getRunTokenStore().save(record),
  findBySelector: async (selector) =>
    (await liveRunStores()).getRunTokenStore().findBySelector(selector),
  endRun: async (runId, endedAt) =>
    (await liveRunStores()).getRunTokenStore().endRun(runId, endedAt),
};

const durableSessions: LiveRunSessionStore = {
  create: async (session) => (await liveRunStores()).getLiveRunSessionStore().create(session),
  find: async (runId) => (await liveRunStores()).getLiveRunSessionStore().find(runId),
  appendEvents: async (input) =>
    (await liveRunStores()).getLiveRunSessionStore().appendEvents(input),
  finish: async (runId, finishedAt) =>
    (await liveRunStores()).getLiveRunSessionStore().finish(runId, finishedAt),
  findStale: async (now, limit) =>
    (await liveRunStores()).getLiveRunSessionStore().findStale(now, limit),
  sweepExpired: async (now) => (await liveRunStores()).getLiveRunSessionStore().sweepExpired(now),
};

/**
 * The production ports, each pointed at the real module.
 *
 * The repository is resolved PER CALL rather than held, because it is bound to
 * the caller's cookie session: one long-lived client would carry one user's
 * session into another user's request. `checkLiveRunPreflight` is called with the
 * clock the pipeline hands it, so a test that pins the clock pins the gate too.
 */
export function liveRunDeps(): LiveRunHostDeps {
  return {
    preflight: async ({ userId, now }) =>
      checkLiveRunPreflight({ userId, ...(now === undefined ? {} : { now }) }),
    tokens: durableTokens,
    sessions: durableSessions,
    repository: {
      async saveRun(userId: string, run: RunResult) {
        // Imported here, not at the top: the factory reaches for the cookie-bound
        // Supabase client, which pulls `next/headers`, and this module has to stay
        // importable by anything that only wants a type off it.
        const { getRunRepository } = await import('@/data/run-repository.factory');
        const repository = await getRunRepository();
        return repository.saveRun(userId, run);
      },
    },
    resolveDetector: () => resolveLiveDetector(),
    logger,
  };
}

/** The one live-run host this process serves every run from. */
export function getLiveRunHost(): LiveRunHost {
  const cache = registry();
  cache.host ??= createLiveRunHost(liveRunDeps());
  return cache.host;
}

/** Note one AUTHENTICATED inbound request. Refused requests never reach here. */
export function noteAgentRequest(runId: string, at: Date = new Date()): void {
  const { activity } = registry();
  const seenAt = at.toISOString();
  const previous = activity.get(runId);
  activity.set(runId, {
    connectedAt: previous?.connectedAt ?? seenAt,
    lastSeenAt: seenAt,
    requests: (previous?.requests ?? 0) + 1,
  });
}

/** What this instance has seen of a run's agent, or `null` if it has seen none. */
export function readAgentActivity(runId: string): AgentActivity | null {
  return registry().activity.get(runId) ?? null;
}

/** Stamp a run finished. A run finishes once, so the first stamp stands. */
export function noteRunFinished(runId: string, at: Date = new Date()): void {
  const { finished } = registry();
  if (!finished.has(runId)) finished.set(runId, at.toISOString());
}

/** When the run finished, or `null` if it has not. */
export function readRunFinishedAt(runId: string): string | null {
  return registry().finished.get(runId) ?? null;
}

/**
 * Drop everything this process holds about live runs.
 *
 * Test seam, mirroring `otpRateLimitStore.reset()`: the registry is process-wide
 * by design, so a suite that could not clear it would carry one test's runs into
 * the next. Production never calls it.
 *
 * It clears the host and the observation maps, and NOT the stores: those are the
 * factory's now, and it clears them through `resetOfflineLiveRunStores()`.
 */
export function resetLiveRunRegistry(): void {
  const holder = globalThis as unknown as RegistryHolder;
  holder[REGISTRY_KEY] = { activity: new Map(), finished: new Map() };
}
