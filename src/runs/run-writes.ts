/**
 * THE ONE MODULE THAT WRITES `public.runs`. SERVER-ONLY.
 *
 * ── WHY IT EXISTS ──
 *
 * A finished run and a discarded run are both rows in `public.runs`, and both
 * used to be inserted through the signed-in caller's own cookie session. That
 * only works while the table lets its owner insert (`runs_insert_own`), and a
 * grant the app relies on is a grant anybody can use: the anon key is public, a
 * session token is the user's to copy, and Supabase's REST API will take an
 * insert or a delete from the two of them with no app in between. Rows inserted
 * that way move the global spend meter for everyone and plant verdicts nobody
 * produced; rows deleted that way hand a spent lifetime allowance back. (Layer 1
 * scan, 2026-10-13, findings F1 and F2.)
 *
 * So the app stops needing the grant. Every insert goes through here, on the
 * SERVICE-ROLE client, and the insert and delete policies can then be dropped
 * without the app noticing.
 *
 * ── THE SERVICE ROLE SKIPS ROW-LEVEL SECURITY, SO THE CHECKS LIVE HERE ──
 *
 * With that client `user_id` is whatever the insert says, and the database
 * checks nothing. This module is therefore where the three questions RLS used
 * to answer are answered, before every write and in this order:
 *
 *   1. WHO IS ASKING. Either the verified server session (`getUser()`, which
 *      asks the auth server with the session cookie every time; never
 *      `getSession()`, a header, a cookie read by hand, or a field of a request
 *      body), or, for a caller that has no session at all (the scheduled pass),
 *      nobody: the owner is then taken from the run's own record.
 *   2. WHOSE RUN IT IS. The run's server-side record (`live_runs`, itself
 *      service-role only) names its owner. The session account must be that
 *      owner, and so must the id the caller passed.
 *   3. WHETHER THE RUN HAS ENDED. A result or a marker is only ever written for
 *      a run that was claimed through the registry's one grant. A row for a run
 *      still open is a row nobody earned.
 *
 * THE RUN'S KIND IS THE RECORD'S, TOO (LAUNCH POLISH, 2026-10-23). Whether the
 * run was an attack or its benign control is written onto the row from the same
 * record, never from the caller, because the leaderboard scores attacks only and
 * the record itself is swept once the run is over.
 *
 * THE ID A CALLER PASSES IS A CLAIM, NEVER A VALUE. `saveRun(userId, run)`
 * keeps the port's shape so the pipeline did not change, but `userId` is only
 * compared. What is written is the owner on the run record.
 *
 * Another account is told exactly what an id that never existed is told
 * (`RUN_NOT_FOUND`), the same answer the pipeline gives one step earlier, so
 * this layer adds no way to learn which runs are real.
 *
 * ── WHAT IS NOT HERE, ON PURPOSE ──
 *
 * The cost gate. `checkLiveRunPreflight` runs in the pipeline, before a token is
 * issued and again before the judge, and is neither repeated nor reordered
 * here: by the time a result reaches this module the judge has been paid, and a
 * third gate could only throw away a verdict that already cost money. READS are
 * not here either. A signed-in user reads their own rows through their own
 * session under `runs_select_own`; the service role is not used to read on a
 * user's behalf, so it cannot be turned into a way to read somebody else's.
 *
 * ── SERVER-ONLY, AND HOW THAT IS HELD ──
 *
 * It imports `@/lib/supabase/server`, which pulls `next/headers`, so a client
 * component that imports this fails to build. That is the repo's convention
 * (there is no `server-only` package in the tree). Two guards stand behind it:
 * `tests/unit/lib/secret-leakage.guard.test.ts` walks the import graph from
 * every `'use client'` module, and `scripts/verify-no-service-role-in-client.ts`
 * reads the built bundle.
 */
import { getSupabaseConfig } from '@/config/env';
import type { RunResult } from '@/contract';
import {
  InMemoryRunRepository,
  type DiscardedRun,
  type DiscardedRunStore,
  type RunRepository,
  type StoredDiscardedRun,
  type StoredRun,
} from '@/data/run-repository';
import { SupabaseRunRepository } from '@/data/run-repository.supabase';
import { getUser } from '@/lib/auth/user';
import { createAdminSupabase } from '@/lib/supabase/server';
import type { LiveRunSessionRecord, LiveRunSessionStore } from '@/runs/live-run-store';
import { getLiveRunSessionStore } from '@/runs/live-run-stores.factory';

/**
 * Why a write was refused.
 *
 * `RUN_NOT_FOUND` covers both a run that does not exist and a run that belongs
 * to somebody else, deliberately. `STORE_UNAVAILABLE` is the deployment with
 * Supabase configured and no service-role key: there is then no client this
 * module may write with, and it does not fall back to the caller's.
 */
export type RunWriteErrorCode =
  'NOT_SIGNED_IN' | 'RUN_NOT_FOUND' | 'RUN_NOT_ENDED' | 'STORE_UNAVAILABLE';

/** The one sentence an unknown run and another account's run both get. */
export const RUN_WRITE_NOT_FOUND_MESSAGE = 'That run was not found.';

const MESSAGES: Record<RunWriteErrorCode, string> = {
  NOT_SIGNED_IN: 'Nobody is signed in, so nothing was saved.',
  RUN_NOT_FOUND: RUN_WRITE_NOT_FOUND_MESSAGE,
  RUN_NOT_ENDED: 'That run has not ended, so it has no result to save.',
  STORE_UNAVAILABLE: 'The run store is not available, so nothing was saved.',
};

/** A refused write, typed. It names no account and no run. */
export class RunWriteError extends Error {
  readonly code: RunWriteErrorCode;

  constructor(code: RunWriteErrorCode) {
    super(MESSAGES[code]);
    this.name = 'RunWriteError';
    this.code = code;
  }
}

/** The two inserts, and nothing else: runs are never updated or deleted. */
export type RunWriter = Pick<RunRepository, 'saveRun'> &
  Pick<DiscardedRunStore, 'saveDiscardedRun'>;

/** Where a run's owner is recorded on the server: the open-run registry. */
export type RunRecords = Pick<LiveRunSessionStore, 'find'>;

/**
 * Where the writing account comes from.
 *
 * `session` is a person at a screen: `userId` must answer from the VERIFIED
 * session, and `null` means nobody is signed in. `run-record` is a caller with
 * no session to have (the scheduled pass), and the owner is then whoever the
 * run's own record names.
 */
export type RunWriteIdentity =
  | { readonly from: 'session'; readonly userId: () => Promise<string | null> }
  | { readonly from: 'run-record' };

export interface RunWriterDeps {
  /** The store written to. In production, the service-role adapter. */
  readonly store: RunWriter;
  /** The server-side record of each run, which names its owner. */
  readonly records: RunRecords;
  readonly identity: RunWriteIdentity;
}

/**
 * The writer, over injected ports. Every rule in the header is here; the two
 * accessors below only bind it to production.
 */
export function createRunWriter(deps: RunWriterDeps): RunWriter {
  /**
   * The account a row for this run may be written under, or a refusal.
   *
   * The session is asked FIRST, before anything about the run is read, so a
   * caller who is not signed in learns nothing from how long the answer took.
   */
  async function ownerOf(runId: string, claimedUserId: string): Promise<LiveRunSessionRecord> {
    let sessionUserId: string | null = null;
    if (deps.identity.from === 'session') {
      sessionUserId = await deps.identity.userId();
      if (sessionUserId === null) throw new RunWriteError('NOT_SIGNED_IN');
    }

    const record = await deps.records.find(runId);
    if (record === null) throw new RunWriteError('RUN_NOT_FOUND');

    const owner = record.userId;
    if (sessionUserId !== null && sessionUserId !== owner) throw new RunWriteError('RUN_NOT_FOUND');
    if (claimedUserId !== owner) throw new RunWriteError('RUN_NOT_FOUND');

    if (record.finishedAt === null) throw new RunWriteError('RUN_NOT_ENDED');
    return record;
  }

  // The kind a caller passes is ignored, like the id: the record's is written.
  return {
    async saveRun(userId: string, run: RunResult): Promise<StoredRun> {
      const record = await ownerOf(run.runId, userId);
      return deps.store.saveRun(record.userId, run, record.kind);
    },

    async saveDiscardedRun(userId: string, discarded: DiscardedRun): Promise<StoredDiscardedRun> {
      const record = await ownerOf(discarded.runId, userId);
      return deps.store.saveDiscardedRun(record.userId, discarded, record.kind);
    },
  };
}

/**
 * The store behind every write: the service-role adapter, or the in-memory one
 * on a clone with no Supabase at all.
 *
 * It does NOT fall back to the caller's cookie client when the service-role key
 * is missing. That fallback would work today and stop working, silently, the
 * day the insert policy is dropped; refusing now is the same failure made
 * visible. No live run can start in that state anyway, because the spend meter
 * needs the same key and fails closed without it.
 */
function serviceRunStore(): RunRepository & DiscardedRunStore {
  if (!getSupabaseConfig()) return new InMemoryRunRepository();
  const admin = createAdminSupabase();
  if (!admin) throw new RunWriteError('STORE_UNAVAILABLE');
  return new SupabaseRunRepository(admin);
}

/**
 * That store, resolved on first USE and then held for the life of one writer.
 *
 * On first use, so building a writer costs nothing and decides nothing: a
 * scheduled pass with no stale run never touches the run table, and must not
 * fail for want of a client it never needed. Held after that, so one pass
 * counts and writes against one store.
 */
function lazyServiceRunStore(): () => RunRepository & DiscardedRunStore {
  let held: (RunRepository & DiscardedRunStore) | undefined;
  return () => (held ??= serviceRunStore());
}

/** The registry, resolved per call like every other durable store. */
const records: RunRecords = {
  find: (runId) => getLiveRunSessionStore().find(runId),
};

/**
 * The writer for a signed-in person: the finish and the discard on `/connect`.
 *
 * The account is read from the verified session here, a second time, and not
 * taken from the pipeline that read it first. One extra round trip per ended
 * run is what it costs for this module to hold its rule on its own, whoever
 * calls it.
 */
export function getSessionRunWriter(): RunWriter {
  const store = lazyServiceRunStore();
  return createRunWriter({
    store: {
      saveRun: (owner, run, kind) => store().saveRun(owner, run, kind),
      saveDiscardedRun: (owner, discarded, kind) =>
        store().saveDiscardedRun(owner, discarded, kind),
    },
    records,
    identity: { from: 'session', userId: async () => (await getUser())?.id ?? null },
  });
}

/** What the scheduled pass needs from the run table. */
export type RunRecordStore = RunWriter &
  Pick<RunRepository, 'findByRunId' | 'countRunsSince'> &
  Pick<DiscardedRunStore, 'findDiscardedByRunId'>;

/**
 * The run table for a caller with NO session: the scheduled pass that settles
 * abandoned runs.
 *
 * A scheduled request carries no cookie, so there is no session to verify and
 * the cookie client would read nothing (and count an allowance of zero used for
 * everybody, a gate that silently passes). Writes go through the same writer,
 * with the owner taken from the run record. The three reads it needs are made
 * with the service role too, as they were before, each narrowed by the owner id
 * the pass read off the run it is settling.
 */
export function getRunRecordStore(): RunRecordStore {
  const store = lazyServiceRunStore();
  const writer = createRunWriter({
    store: {
      saveRun: (owner, run, kind) => store().saveRun(owner, run, kind),
      saveDiscardedRun: (owner, discarded, kind) =>
        store().saveDiscardedRun(owner, discarded, kind),
    },
    records,
    identity: { from: 'run-record' },
  });
  return {
    saveRun: (userId, run) => writer.saveRun(userId, run),
    saveDiscardedRun: (userId, discarded) => writer.saveDiscardedRun(userId, discarded),
    // `async` so a store that cannot be built is a rejected read, never a throw
    // out of a call the caller expected a promise from.
    findByRunId: async (userId, runId) => store().findByRunId(userId, runId),
    findDiscardedByRunId: async (userId, runId) => store().findDiscardedByRunId(userId, runId),
    countRunsSince: async (userId, since) => store().countRunsSince(userId, since),
  };
}
