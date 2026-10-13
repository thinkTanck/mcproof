// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RLS_LOCAL_STACK,
  adminClient,
  anonClient,
  removeUser,
  signedInUser,
  type SignedInUser,
} from './local-stack';

/**
 * WHAT A SIGNED-IN USER CAN DO TO THE DATABASE WITH NO APP IN THE WAY.
 *
 * The anon key is public and a session token is its owner's to copy, so anybody
 * can talk to Supabase's REST API directly as themselves. Whatever the database
 * lets the `authenticated` role do, a user can do, whether or not any screen
 * offers it. This suite asks the database, as a real signed-in owner, a real
 * signed-in stranger and an anonymous visitor, to INSERT, UPDATE and DELETE,
 * and asserts each is REFUSED. Every refusal is checked against the truth read
 * back with the service role, not against the error alone.
 *
 * It needs the local stack and is skipped without it. To run it:
 *
 *   npx --yes supabase@2.120.0 start
 *   npx --yes supabase@2.120.0 status -o env > .supabase-local.env
 *   (export API_URL as NEXT_PUBLIC_SUPABASE_URL, ANON_KEY as
 *    NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE_ROLE_KEY as SUPABASE_SERVICE_ROLE_KEY)
 *   RLS_LOCAL_STACK=1 npx vitest run tests/integration/rls
 *
 * See `supabase/README.md` for the one-line version.
 *
 * ── THE TWO `it.fails` BELOW, AND WHEN TO REMOVE THEM ──
 *
 * Today `public.runs` carries `runs_insert_own` and `runs_delete_own`, so an
 * owner CAN insert and delete their own rows directly. That is findings F1 and
 * F2 of the 2026-10-13 scan: a delete hands a spent lifetime allowance back, and
 * an insert moves the global spend meter and plants a verdict nobody produced.
 * The app no longer needs either grant (every write goes through
 * `src/runs/run-writes.ts` on the service role), but the policies are dropped by
 * a separate migration, lane S1b. Until it lands those two assertions cannot
 * hold, so they are marked `it.fails`: the suite passes now, and the moment S1b
 * drops the policies they start PASSING, which `it.fails` reports as a failure.
 * That failure is the instruction: delete the `.fails` on both.
 */

type Row = { id: string; user_id: string; created_at: string; run: unknown };

const RUN_COLS = 'id, user_id, created_at, run';

/**
 * Each test is a handful of real HTTP round trips to a database in a container,
 * so the default five seconds is the wrong budget for it.
 */
const STACK_TIMEOUT = { timeout: 30_000 } as const;

/** A payload shaped like nothing the app writes, so a forged row is recognisable. */
const forged = (tag: string) => ({ forgedBy: 'rls-suite', tag });

describe.runIf(RLS_LOCAL_STACK)('RLS: public.runs, asked directly', STACK_TIMEOUT, () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let owner: SignedInUser;
  let stranger: SignedInUser;
  /** A row the service role wrote for the owner. No test below may change it. */
  let sentinel: Row;

  /** One more service-role row for the owner, for a test that might destroy it. */
  async function seed(tag: string, userId: string = owner.id): Promise<Row> {
    const { data, error } = await admin
      .from('runs')
      .insert({ user_id: userId, run: { seededBy: 'service-role', tag } })
      .select(RUN_COLS)
      .single();
    if (error) throw new Error(`seed(${tag}) failed: ${error.message}`);
    return data as Row;
  }

  /** The row as it really is, read with the service role. Null when it is gone. */
  async function truth(id: string): Promise<Row | null> {
    const { data, error } = await admin.from('runs').select(RUN_COLS).eq('id', id).maybeSingle();
    if (error) throw new Error(`truth read failed: ${error.message}`);
    return (data as Row | null) ?? null;
  }

  /** How many rows the account really has. */
  async function rowCount(userId: string): Promise<number> {
    const { count, error } = await admin
      .from('runs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (error || count === null) throw new Error('count read failed');
    return count;
  }

  beforeAll(async () => {
    admin = adminClient();
    anon = anonClient();
    owner = await signedInUser(admin, 'owner');
    stranger = await signedInUser(admin, 'stranger');
    sentinel = await seed('sentinel');
  }, 60_000);

  afterAll(async () => {
    await removeUser(admin, owner);
    await removeUser(admin, stranger);
  }, 60_000);

  // ── SELECT stays owner-only ──

  it('SELECT: the owner reads their own row', async () => {
    const { data, error } = await owner.client.from('runs').select(RUN_COLS).eq('id', sentinel.id);

    expect(error).toBeNull();
    expect(data).toEqual([sentinel]);
  });

  it('SELECT: another signed-in user sees none of the owner’s rows', async () => {
    const all = await stranger.client.from('runs').select('id, user_id');
    const direct = await stranger.client.from('runs').select('id').eq('id', sentinel.id);

    expect(all.error).toBeNull();
    expect((all.data ?? []).every((row) => row.user_id === stranger.id)).toBe(true);
    expect(direct.data).toEqual([]);
  });

  it('SELECT: an anonymous visitor sees no rows at all', async () => {
    const { data } = await anon.from('runs').select('id');

    expect(data ?? []).toEqual([]);
  });

  // ── INSERT ──

  // S1b: remove `.fails` once the migration drops `runs_insert_own`. This is F2.
  it.fails('INSERT: the owner cannot insert a row for themselves (F2)', async () => {
    const before = await rowCount(owner.id);

    const { error } = await owner.client
      .from('runs')
      .insert({ user_id: owner.id, run: forged('owner-insert') });

    expect(error).not.toBeNull();
    expect(await rowCount(owner.id)).toBe(before);
  });

  it('INSERT: a signed-in user cannot insert a row for somebody else', async () => {
    const before = await rowCount(owner.id);

    const { error } = await stranger.client
      .from('runs')
      .insert({ user_id: owner.id, run: forged('stranger-insert') });

    expect(error).not.toBeNull();
    expect(await rowCount(owner.id)).toBe(before);
  });

  it('INSERT: an anonymous visitor cannot insert a row for anybody', async () => {
    const before = await rowCount(owner.id);

    const { error } = await anon
      .from('runs')
      .insert({ user_id: owner.id, run: forged('anon-insert') });

    expect(error).not.toBeNull();
    expect(await rowCount(owner.id)).toBe(before);
  });

  // ── UPDATE: no policy exists, so the table grant alone does not allow it ──

  it('UPDATE: the owner cannot change their own row, its verdict or its timestamp', async () => {
    const row = await seed('owner-update');

    const payload = await owner.client
      .from('runs')
      .update({ run: forged('owner-update') })
      .eq('id', row.id)
      .select('id');
    const backdated = await owner.client
      .from('runs')
      .update({ created_at: '2020-01-01T00:00:00.000Z' })
      .eq('id', row.id)
      .select('id');

    // RLS with no UPDATE policy matches no row: nothing is returned as updated.
    expect(payload.data ?? []).toEqual([]);
    expect(backdated.data ?? []).toEqual([]);
    expect(await truth(row.id)).toEqual(row);
  });

  it('UPDATE: the owner cannot hand their row to another account', async () => {
    const row = await seed('owner-reassign');

    await owner.client.from('runs').update({ user_id: stranger.id }).eq('id', row.id);

    expect(await truth(row.id)).toEqual(row);
  });

  it('UPDATE: another signed-in user cannot change the owner’s row', async () => {
    const row = await seed('stranger-update');

    const attempt = await stranger.client
      .from('runs')
      .update({ run: forged('stranger-update') })
      .eq('id', row.id)
      .select('id');

    expect(attempt.data ?? []).toEqual([]);
    expect(await truth(row.id)).toEqual(row);
  });

  it('UPDATE: an anonymous visitor cannot change a row', async () => {
    const row = await seed('anon-update');

    await anon
      .from('runs')
      .update({ run: forged('anon-update') })
      .eq('id', row.id);

    expect(await truth(row.id)).toEqual(row);
  });

  // ── DELETE ──

  // S1b: remove `.fails` once the migration drops `runs_delete_own`. This is F1.
  it.fails('DELETE: the owner cannot delete their own row (F1)', async () => {
    const row = await seed('owner-delete');

    await owner.client.from('runs').delete().eq('id', row.id);

    expect(await truth(row.id)).toEqual(row);
  });

  it('DELETE: another signed-in user cannot delete the owner’s row', async () => {
    const row = await seed('stranger-delete');

    const attempt = await stranger.client.from('runs').delete().eq('id', row.id).select('id');

    expect(attempt.data ?? []).toEqual([]);
    expect(await truth(row.id)).toEqual(row);
  });

  it('DELETE: an anonymous visitor cannot delete a row', async () => {
    const row = await seed('anon-delete');

    await anon.from('runs').delete().eq('id', row.id);

    expect(await truth(row.id)).toEqual(row);
  });

  // ── After all of the above ──

  it('the row the service role wrote is exactly as it was written', async () => {
    expect(await truth(sentinel.id)).toEqual(sentinel);
  });
});

/**
 * THE FOUR CLOSED TABLES.
 *
 * `run_tokens`, `live_runs`, `live_run_events` and `otp_rate_limit_hits` have
 * RLS on, ZERO policies, and every privilege revoked from `anon` and
 * `authenticated` (migrations 0002 and 0003). Nobody but the service role can
 * read, add, change or remove a row, and that is asserted here per table, per
 * role and per operation, with the seeded row read back afterwards.
 */
describe.runIf(RLS_LOCAL_STACK)('RLS: the closed tables, asked directly', STACK_TIMEOUT, () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let user: SignedInUser;
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const runId = `rls-run-${nonce}`;
  const selector = `rls-selector-${nonce}`;
  const bucket = `rls-bucket-${nonce}`;
  const future = new Date(Date.now() + 3_600_000).toISOString();

  interface Closed {
    readonly table: string;
    /** Selects the seeded row and nothing else. */
    readonly match: Record<string, string | number>;
    /**
     * The column and prefix that select everything THIS suite could have put in
     * the table: the seeded row and any row a refused insert would have added.
     * The snapshot is scoped to it so another suite writing to the same local
     * database at the same time cannot make a refusal look like a change.
     */
    readonly scope: readonly [column: string, prefix: string];
    /** A new row a client would try to add. */
    readonly insert: () => Record<string, unknown>;
    /** A change a client would try to make to the seeded row. */
    readonly update: Record<string, unknown>;
  }

  const tables = (): Closed[] => [
    {
      table: 'run_tokens',
      match: { selector },
      scope: ['run_id', runId],
      insert: () => ({
        selector: `${selector}-forged`,
        verifier_hash: 'f'.repeat(64),
        run_id: runId,
        user_id: user.id,
        expires_at: future,
      }),
      update: { ended_at: null, expires_at: '2999-01-01T00:00:00.000Z' },
    },
    {
      table: 'live_runs',
      match: { run_id: runId },
      scope: ['run_id', runId],
      insert: () => ({
        run_id: `${runId}-forged`,
        user_id: user.id,
        category: 'ASI01',
        kind: 'malicious',
        target: '/api/mcp',
        expires_at: future,
      }),
      update: { finished_at: null, kind: 'benign' },
    },
    {
      table: 'live_run_events',
      match: { run_id: runId, idx: 0 },
      scope: ['run_id', runId],
      insert: () => ({ run_id: runId, idx: 1, event: { type: 'tool_call', forged: true } }),
      update: { event: { type: 'tool_call', forged: true } },
    },
    {
      table: 'otp_rate_limit_hits',
      match: { bucket },
      scope: ['bucket', bucket],
      insert: () => ({ bucket: `${bucket}-forged`, hit_at: future, expires_at: future }),
      update: { hit_at: '2000-01-01T00:00:00.000Z' },
    },
  ];

  /** The part of a supabase-js query this suite needs: narrow it, then await it. */
  interface Narrowable extends PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
  }> {
    eq(column: string, value: string | number): Narrowable;
  }

  /** The query, narrowed to the seeded row. */
  const filtered = (query: unknown, match: Closed['match']): Narrowable =>
    Object.entries(match).reduce((q, [column, value]) => q.eq(column, value), query as Narrowable);

  /** This suite's rows as the service role sees them, in a stable order. */
  async function snapshot({ table, scope: [column, prefix] }: Closed): Promise<string> {
    const { data, error } = await admin.from(table).select('*').like(column, `${prefix}%`);
    if (error) throw new Error(`snapshot(${table}) failed: ${error.message}`);
    return JSON.stringify(
      (data ?? []).map((row) => JSON.stringify(row, Object.keys(row).sort())).sort(),
    );
  }

  beforeAll(async () => {
    admin = adminClient();
    anon = anonClient();
    user = await signedInUser(admin, 'closed');
    const seeded = [
      await admin.from('live_runs').insert({
        run_id: runId,
        user_id: user.id,
        category: 'ASI01',
        kind: 'malicious',
        target: '/api/mcp',
        expires_at: future,
      }),
      await admin.from('live_run_events').insert({
        run_id: runId,
        idx: 0,
        event: { type: 'principal_instruction' },
      }),
      await admin.from('run_tokens').insert({
        selector,
        verifier_hash: 'a'.repeat(64),
        run_id: runId,
        user_id: user.id,
        expires_at: future,
      }),
      await admin
        .from('otp_rate_limit_hits')
        .insert({ bucket, hit_at: new Date().toISOString(), expires_at: future }),
    ];
    const failed = seeded.find((answer) => answer.error);
    if (failed?.error) throw new Error(`seeding a closed table failed: ${failed.error.message}`);
  }, 60_000);

  afterAll(async () => {
    await admin.from('otp_rate_limit_hits').delete().like('bucket', `${bucket}%`);
    await removeUser(admin, user);
  }, 60_000);

  it('the service role can see what it seeded, so a refusal below is not an empty table', async () => {
    for (const { table, match } of tables()) {
      const { data, error } = await filtered(admin.from(table).select('*'), match);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }
  });

  describe.each(['authenticated', 'anon'] as const)('as %s', (role) => {
    const client = () => (role === 'authenticated' ? user.client : anon);

    it.each(['run_tokens', 'live_runs', 'live_run_events', 'otp_rate_limit_hits'])(
      '%s: SELECT, INSERT, UPDATE and DELETE are all refused, and nothing changed',
      async (name) => {
        const spec = tables().find((entry) => entry.table === name)!;
        const before = await snapshot(spec);
        expect(before).not.toBe('[]');

        const read = await client().from(name).select('*');
        const added = await client().from(name).insert(spec.insert());
        const changed = await filtered(client().from(name).update(spec.update), spec.match);
        const removed = await filtered(client().from(name).delete(), spec.match);

        // The grant is revoked, so each is refused outright rather than
        // answered with an empty set.
        expect(read.data ?? []).toEqual([]);
        expect(read.error).not.toBeNull();
        expect(added.error).not.toBeNull();
        expect(changed.error).not.toBeNull();
        expect(removed.error).not.toBeNull();
        expect(await snapshot(spec)).toBe(before);
      },
    );
  });
});
