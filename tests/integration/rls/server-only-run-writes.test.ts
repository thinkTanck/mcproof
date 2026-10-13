// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRunReader, SupabaseRunRepository } from '@/data/run-repository.supabase';
import type { LiveDetector } from '@/detector/resolve';
import { SESSION_HEADER } from '@/harness/server/http';
import { createLiveRunHost, type LiveRunHost, type LiveRunTicket } from '@/runs/live-run';
import { SupabaseLiveRunSessionStore } from '@/runs/live-run-store.supabase';
import { checkLiveRunPreflight } from '@/runs/preflight';
import { SupabaseRunTokenStore } from '@/runs/run-token.supabase';
import { createRunWriter } from '@/runs/run-writes';
import { createRunTableSpendMeter } from '@/runs/spend-cap';
import {
  RLS_LOCAL_STACK,
  adminClient,
  removeUser,
  signedInUser,
  type SignedInUser,
} from './local-stack';

/**
 * THE APP'S OWN WRITE PATHS, AGAINST A REAL DATABASE.
 *
 * `runs-rls.test.ts` shows what a user can do to `public.runs` directly. This
 * is the other half: that the app itself no longer needs the user to be able to
 * do any of it. It drives the real pipeline (start, an agent request, finish,
 * discard) over the real Postgres adapters, with every `runs` write going
 * through the run writer on the SERVICE-ROLE client and every read on the
 * signed-in user's own session.
 *
 * Nothing in it depends on `runs_insert_own` or `runs_delete_own`. It passed
 * with those policies in place (lane S1a) and it passes with them dropped and
 * the table's grants closed (migration 0004, lane S1b), which is the schema the
 * local stack now starts with. That is the point: the migration does not break
 * the app's create, finish or discard, because none of them ever asked the
 * user's session to write.
 *
 * The judge is a stub. No model is called, and the gate is the real
 * `checkLiveRunPreflight` over the real tables.
 */
describe.runIf(RLS_LOCAL_STACK)('the app writes runs with the service role (local stack)', () => {
  let admin: SupabaseClient;
  let owner: SignedInUser;
  let stranger: SignedInUser;
  /** Who the session writer believes is signed in: a real user's verified id. */
  let signedInAs: SignedInUser;
  let host: LiveRunHost;
  let allowance = '3';
  let judged = 0;

  const detector: LiveDetector = async (trace) => {
    judged += 1;
    return {
      runId: trace.runId,
      compromised: false,
      score: 0.05,
      severity: 'None',
      category: trace.category,
      rationale: 'The agent did not act on the injected instruction.',
    };
  };

  /** The account the auth server says this client's session belongs to. */
  async function verifiedUserId(user: SignedInUser): Promise<string | null> {
    const { data } = await user.client.auth.getUser();
    return data.user?.id ?? null;
  }

  async function rows(userId: string) {
    const { data, error } = await admin
      .from('runs')
      .select('id, user_id, run')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(`rows read failed: ${error.message}`);
    return data ?? [];
  }

  async function openRuns(userId: string): Promise<number> {
    const { count, error } = await admin
      .from('live_runs')
      .select('run_id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (error || count === null) throw new Error('live_runs count failed');
    return count;
  }

  async function agentLists(ticket: LiveRunTicket): Promise<void> {
    const send = async (payload: unknown, sessionId?: string): Promise<Response> => {
      const headers = new Headers({
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${ticket.token}`,
      });
      if (sessionId !== undefined) headers.set(SESSION_HEADER, sessionId);
      return host.handle(
        new Request(ticket.endpoint, { method: 'POST', headers, body: JSON.stringify(payload) }),
      );
    };
    const opened = await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'local-stack-agent' } },
    });
    expect(opened.status).toBe(200);
    const sessionId = opened.headers.get(SESSION_HEADER) ?? undefined;
    await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sessionId);
  }

  beforeAll(async () => {
    admin = adminClient();
    owner = await signedInUser(admin, 'writer-owner');
    stranger = await signedInUser(admin, 'writer-stranger');
    signedInAs = owner;

    const sessions = new SupabaseLiveRunSessionStore(admin);
    const writer = createRunWriter({
      store: new SupabaseRunRepository(admin),
      records: sessions,
      identity: { from: 'session', userId: () => verifiedUserId(signedInAs) },
    });
    host = createLiveRunHost({
      // The real gate: the allowance counted through the user's OWN session
      // (reads stay under `runs_select_own`), the spend meter on the service role.
      preflight: ({ userId, now }) =>
        checkLiveRunPreflight({
          userId,
          repository: new SupabaseRunReader(signedInAs.client),
          meter: createRunTableSpendMeter(admin),
          env: { LIVE_RUN_ALLOWANCE: allowance, LIVE_RUN_SPEND_CAP: '100000' },
          ...(now === undefined ? {} : { now }),
        }),
      tokens: new SupabaseRunTokenStore(admin),
      sessions,
      repository: {
        saveRun: (userId, run) => writer.saveRun(userId, run),
        saveDiscardedRun: (userId, marker) => writer.saveDiscardedRun(userId, marker),
        // Reads on the signed-in user's own session, as in production.
        findByRunId: (userId, runId) =>
          new SupabaseRunReader(signedInAs.client).findByRunId(userId, runId),
        findDiscardedByRunId: (userId, runId) =>
          new SupabaseRunReader(signedInAs.client).findDiscardedByRunId(userId, runId),
      },
      resolveDetector: () => detector,
      origin: 'https://mcproof.test',
    });
  }, 60_000);

  afterAll(async () => {
    await removeUser(admin, owner);
    await removeUser(admin, stranger);
  }, 60_000);

  it('create and finish: the judged row is written for the owner and readable by the owner only', async () => {
    const started = await host.start({ userId: owner.id, category: 'ASI01' });
    if (!started.ok) throw started.error;
    await agentLists(started.value);

    const finished = await host.finish({ runId: started.value.runId, userId: owner.id });

    if (!finished.ok) throw finished.error;
    const stored = await rows(owner.id);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.user_id).toBe(owner.id);
    expect(stored[0]!.id).toBe(finished.value.stored.id);
    // The owner reads it back through their own session; a stranger cannot.
    const mine = await new SupabaseRunReader(owner.client).getRun(owner.id, stored[0]!.id);
    const theirs = await new SupabaseRunReader(stranger.client).getRun(owner.id, stored[0]!.id);
    expect(mine?.run.runId).toBe(started.value.runId);
    expect(theirs).toBeNull();
  }, 60_000);

  it('create and discard: a marker with no verdict, counted by the allowance and not by the meter', async () => {
    const meter = createRunTableSpendMeter(admin);
    const spentBefore = await meter.countRunsSince(new Date(0));
    const usedBefore = await new SupabaseRunReader(owner.client).countRunsSince(
      owner.id,
      new Date(0),
    );
    const judgedBefore = judged;
    const started = await host.start({ userId: owner.id, category: 'ASI02' });
    if (!started.ok) throw started.error;
    await agentLists(started.value);

    const discarded = await host.discard({ runId: started.value.runId, userId: owner.id });

    if (!discarded.ok) throw discarded.error;
    expect(discarded.value.storedRunId).not.toBeNull();
    const marker = (await rows(owner.id)).find((row) => row.id === discarded.value.storedRunId);
    expect(marker?.user_id).toBe(owner.id);
    expect(marker?.run).toMatchObject({ discarded: true, runId: started.value.runId });
    expect(Object.keys(marker?.run as object)).not.toContain('verdict');
    expect(judged).toBe(judgedBefore);
    // ADR-0013: still one of the account's runs, and not a judge call.
    expect(await new SupabaseRunReader(owner.client).countRunsSince(owner.id, new Date(0))).toBe(
      usedBefore + 1,
    );
    expect(await meter.countRunsSince(new Date(0))).toBe(spentBefore);
    // And it cannot be finished afterwards.
    const again = await host.finish({ runId: started.value.runId, userId: owner.id });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('RUN_DISCARDED');
  }, 60_000);

  it('a stranger finishing or discarding the owner’s run writes nothing', async () => {
    const started = await host.start({ userId: owner.id, category: 'ASI03' });
    if (!started.ok) throw started.error;
    const before = (await rows(owner.id)).length;
    signedInAs = stranger;
    try {
      const finish = await host.finish({ runId: started.value.runId, userId: stranger.id });
      const discard = await host.discard({ runId: started.value.runId, userId: stranger.id });
      // And with the owner's id handed in from the stranger's session.
      const forged = await host.discard({ runId: started.value.runId, userId: owner.id });

      expect(finish.ok).toBe(false);
      expect(discard.ok).toBe(false);
      if (!finish.ok) expect(finish.error.code).toBe('RUN_NOT_FOUND');
      if (!discard.ok) expect(discard.error.code).toBe('RUN_NOT_FOUND');
      // The pipeline was handed the owner's id, so it claimed the run; the
      // writer, which asks the session itself, refused the marker.
      expect(forged.ok && forged.value.storedRunId).toBe(null);
    } finally {
      signedInAs = owner;
    }
    expect(await rows(owner.id)).toHaveLength(before);
    expect(await rows(stranger.id)).toEqual([]);
  }, 60_000);

  it('a refused allowance writes nothing: no run record, no token, no row', async () => {
    const used = (await rows(owner.id)).length;
    const open = await openRuns(owner.id);
    allowance = String(used);
    try {
      const refused = await host.start({ userId: owner.id, category: 'ASI01' });

      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe('ALLOWANCE_EXHAUSTED');
    } finally {
      allowance = '3';
    }
    expect(await rows(owner.id)).toHaveLength(used);
    expect(await openRuns(owner.id)).toBe(open);
  }, 60_000);

  it('an allowance that runs out mid-run stops the finish before the judge, and writes nothing', async () => {
    // A fresh account, so the count is known: it has started nothing yet.
    const fresh = await signedInUser(admin, 'writer-fresh');
    signedInAs = fresh;
    const judgedBefore = judged;
    try {
      allowance = '1';
      const started = await host.start({ userId: fresh.id, category: 'ASI01' });
      if (!started.ok) throw started.error;
      await agentLists(started.value);
      allowance = '0';

      const finished = await host.finish({ runId: started.value.runId, userId: fresh.id });

      expect(finished.ok).toBe(false);
      if (!finished.ok) expect(finished.error.code).toBe('ALLOWANCE_EXHAUSTED');
      expect(judged).toBe(judgedBefore);
      expect(await rows(fresh.id)).toEqual([]);
    } finally {
      allowance = '3';
      signedInAs = owner;
      await removeUser(admin, fresh);
    }
  }, 60_000);
});
