/**
 * THE PRODUCTION WIRING of the run writer: which client writes, and where the
 * account comes from.
 *
 * `tests/unit/runs/run-writes.test.ts` holds the rules. This file holds the two
 * facts about production that those rules stand on:
 *
 *   - the write goes out on the SERVICE-ROLE client, and the caller's cookie
 *     client is never asked to write anything;
 *   - the account is what `supabase.auth.getUser()` says on the server. Not
 *     `getSession()`, which trusts the cookie without asking the auth server,
 *     and not a header, a body field or an argument.
 */
import type { RunResult } from '@/contract';
import { getDataSource } from '@/data/source';
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase/server';
import { InMemoryLiveRunSessionStore } from '@/runs/live-run-store';
import { getLiveRunSessionStore } from '@/runs/live-run-stores.factory';
import { RunWriteError, getRunRecordStore, getSessionRunWriter } from '@/runs/run-writes';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(),
  createAdminSupabase: vi.fn(),
}));
vi.mock('@/runs/live-run-stores.factory', () => ({ getLiveRunSessionStore: vi.fn() }));

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const RUN = 'run-wired';

async function result(): Promise<RunResult> {
  const sample = await getDataSource().getRun('sample');
  if (!sample) throw new Error('sample run missing');
  return { ...sample, runId: RUN };
}

/** A service-role client that records what was inserted and answers with the row. */
function adminClient() {
  const inserts: { table: string; row: { user_id: string; run: unknown } }[] = [];
  const from = vi.fn((table: string) => {
    let row: { user_id: string; run: unknown } | null = null;
    const builder = {
      insert(value: { user_id: string; run: unknown }) {
        row = value;
        inserts.push({ table, row: value });
        return builder;
      },
      select: () => builder,
      single: async () => ({
        data: { id: 'row-1', created_at: '2026-10-13T10:00:00.000Z', ...row },
        error: null,
      }),
    };
    return builder;
  });
  return { client: { from } as never, from, inserts };
}

/** The caller's cookie client: an auth server to ask, and a table API to stay off. */
function cookieClient(userId: string | null) {
  const getUser = vi.fn(async () => ({ data: { user: userId === null ? null : { id: userId } } }));
  const getSession = vi.fn(async () => ({ data: { session: { user: { id: OTHER } } } }));
  const from = vi.fn(() => {
    throw new Error('the cookie client must never be used to write a run');
  });
  return { client: { auth: { getUser, getSession }, from } as never, getUser, getSession, from };
}

async function endedRun(owner: string = OWNER) {
  const sessions = new InMemoryLiveRunSessionStore();
  await sessions.create({
    runId: RUN,
    userId: owner,
    category: 'ASI01',
    kind: 'malicious',
    model: null,
    client: null,
    target: '/api/mcp',
    startedAt: '2026-10-13T09:00:00.000Z',
    expiresAt: '2026-10-14T09:00:00.000Z',
    events: [],
  });
  await sessions.finish(RUN, new Date('2026-10-13T09:30:00.000Z'));
  vi.mocked(getLiveRunSessionStore).mockReturnValue(sessions);
  return sessions;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the session run writer, as production builds it', () => {
  it('inserts on the service-role client, under the account the auth server names', async () => {
    await endedRun();
    const admin = adminClient();
    const cookie = cookieClient(OWNER);
    vi.mocked(createAdminSupabase).mockReturnValue(admin.client);
    vi.mocked(createServerSupabase).mockResolvedValue(cookie.client);

    const stored = await getSessionRunWriter().saveRun(OWNER, await result());

    expect(stored.userId).toBe(OWNER);
    expect(admin.inserts).toHaveLength(1);
    expect(admin.inserts[0]!.table).toBe('runs');
    expect(admin.inserts[0]!.row.user_id).toBe(OWNER);
    expect(cookie.from).not.toHaveBeenCalled();
  });

  it('asks getUser(), and never trusts getSession()', async () => {
    await endedRun();
    const admin = adminClient();
    const cookie = cookieClient(OWNER);
    vi.mocked(createAdminSupabase).mockReturnValue(admin.client);
    vi.mocked(createServerSupabase).mockResolvedValue(cookie.client);

    await getSessionRunWriter().saveRun(OWNER, await result());

    expect(cookie.getUser).toHaveBeenCalled();
    expect(cookie.getSession).not.toHaveBeenCalled();
  });

  it('writes nothing for a caller who claims the owner’s id from another session', async () => {
    await endedRun();
    const admin = adminClient();
    vi.mocked(createAdminSupabase).mockReturnValue(admin.client);
    vi.mocked(createServerSupabase).mockResolvedValue(cookieClient(OTHER).client);

    await expect(getSessionRunWriter().saveRun(OWNER, await result())).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    });
    expect(admin.inserts).toEqual([]);
  });

  it('writes nothing when the session has lapsed', async () => {
    await endedRun();
    const admin = adminClient();
    vi.mocked(createAdminSupabase).mockReturnValue(admin.client);
    vi.mocked(createServerSupabase).mockResolvedValue(cookieClient(null).client);

    await expect(getSessionRunWriter().saveRun(OWNER, await result())).rejects.toMatchObject({
      code: 'NOT_SIGNED_IN',
    });
    expect(admin.inserts).toEqual([]);
  });

  it('stores the discard marker on the service-role client too', async () => {
    await endedRun();
    const admin = adminClient();
    const cookie = cookieClient(OWNER);
    vi.mocked(createAdminSupabase).mockReturnValue(admin.client);
    vi.mocked(createServerSupabase).mockResolvedValue(cookie.client);

    const stored = await getSessionRunWriter().saveDiscardedRun(OWNER, {
      discarded: true,
      runId: RUN,
      category: 'ASI01',
      model: 'manual-client',
      steps: 2,
      toolCalls: 1,
      discardedAt: '2026-10-13T10:00:00.000Z',
    });

    expect(stored.userId).toBe(OWNER);
    expect(admin.inserts[0]!.row.user_id).toBe(OWNER);
    expect(Object.keys(admin.inserts[0]!.row.run as object)).not.toContain('verdict');
    expect(cookie.from).not.toHaveBeenCalled();
  });

  it('fails closed with no service-role key: it never falls back to the cookie client', async () => {
    await endedRun();
    const cookie = cookieClient(OWNER);
    vi.mocked(createAdminSupabase).mockReturnValue(null);
    vi.mocked(createServerSupabase).mockResolvedValue(cookie.client);

    let thrown: unknown;
    try {
      await getSessionRunWriter().saveRun(OWNER, await result());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RunWriteError);
    expect((thrown as RunWriteError).code).toBe('STORE_UNAVAILABLE');
    expect(cookie.from).not.toHaveBeenCalled();
  });
});

describe('the run-record store, as the scheduled pass builds it', () => {
  it('writes under the owner the run record names, with no session anywhere', async () => {
    await endedRun();
    const admin = adminClient();
    vi.mocked(createAdminSupabase).mockReturnValue(admin.client);

    const stored = await getRunRecordStore().saveRun(OWNER, await result());

    expect(stored.userId).toBe(OWNER);
    expect(admin.inserts[0]!.row.user_id).toBe(OWNER);
    expect(createServerSupabase).not.toHaveBeenCalled();
  });

  it('refuses an owner the run record does not name', async () => {
    await endedRun();
    const admin = adminClient();
    vi.mocked(createAdminSupabase).mockReturnValue(admin.client);

    await expect(getRunRecordStore().saveRun(OTHER, await result())).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    });
    expect(admin.inserts).toEqual([]);
  });

  it('holds a marker to the same rule: the record’s owner, and nobody else', async () => {
    await endedRun();
    const admin = adminClient();
    vi.mocked(createAdminSupabase).mockReturnValue(admin.client);
    const marker = {
      discarded: true as const,
      runId: RUN,
      category: 'ASI01' as const,
      model: 'manual-client',
      steps: 2,
      toolCalls: 1,
      discardedAt: '2026-10-13T10:00:00.000Z',
    };

    await expect(getRunRecordStore().saveDiscardedRun(OTHER, marker)).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    });
    const stored = await getRunRecordStore().saveDiscardedRun(OWNER, marker);

    expect(stored.userId).toBe(OWNER);
    expect(admin.inserts.map((insert) => insert.row.user_id)).toEqual([OWNER]);
  });

  it('fails closed with no service-role key, on the write and on the count the gate reads', async () => {
    await endedRun();
    vi.mocked(createAdminSupabase).mockReturnValue(null);
    const store = getRunRecordStore();

    await expect(store.saveRun(OWNER, await result())).rejects.toMatchObject({
      code: 'STORE_UNAVAILABLE',
    });
    await expect(store.countRunsSince(OWNER, new Date(0))).rejects.toBeInstanceOf(RunWriteError);
    await expect(store.findByRunId(OWNER, RUN)).rejects.toBeInstanceOf(RunWriteError);
    await expect(store.findDiscardedByRunId(OWNER, RUN)).rejects.toBeInstanceOf(RunWriteError);
  });

  it('costs nothing to build: a pass with no run to settle never asks for a client', () => {
    getRunRecordStore();
    getSessionRunWriter();

    expect(createAdminSupabase).not.toHaveBeenCalled();
    expect(createServerSupabase).not.toHaveBeenCalled();
  });

  it('reads with the service role, narrowed by the owner it was given', async () => {
    await endedRun();
    const filters: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => (filters.push([column, value]), builder),
      gte: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (answer: unknown) => void) => resolve({ count: 2, error: null }),
    };
    vi.mocked(createAdminSupabase).mockReturnValue({ from: () => builder } as never);
    const store = getRunRecordStore();

    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(2);
    expect(await store.findByRunId(OWNER, RUN)).toBeNull();
    expect(await store.findDiscardedByRunId(OWNER, RUN)).toBeNull();
    expect(filters.filter(([column]) => column === 'user_id').map(([, value]) => value)).toEqual([
      OWNER,
      OWNER,
      OWNER,
    ]);
    expect(createServerSupabase).not.toHaveBeenCalled();
  });
});

describe('with no Supabase configured (an offline clone)', () => {
  it('still builds, and writes nothing because nobody can be signed in', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    await endedRun();
    vi.mocked(createServerSupabase).mockResolvedValue(null);

    await expect(getSessionRunWriter().saveRun(OWNER, await result())).rejects.toMatchObject({
      code: 'NOT_SIGNED_IN',
    });
    expect(createAdminSupabase).not.toHaveBeenCalled();
  });
});
