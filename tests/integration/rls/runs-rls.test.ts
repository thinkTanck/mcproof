// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RLS_LOCAL_STACK,
  adminClient,
  anonClient,
  catalog,
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
 * ── WHAT CLOSED `public.runs`, AND HOW EACH REFUSAL IS ANSWERED ──
 *
 * Until migration 0004 (security lane S1b) the table carried `runs_insert_own`
 * and `runs_delete_own`, so an owner COULD insert and delete their own rows
 * directly. Those were findings F1 and F2 of the 2026-10-13 scan: a delete
 * handed a spent lifetime allowance back, and an insert moved the global spend
 * meter and planted a verdict nobody produced. The two assertions for them
 * were `it.fails` while the policies stood, and became plain `it` in the
 * commit that added the migration that dropped them.
 *
 * 0004 closes the table at both layers. The two policies are gone, the one that
 * is left (`runs_select_own`) is scoped to `authenticated`, and the table
 * grants are cut to match: `anon` holds nothing and `authenticated` holds
 * SELECT alone. So a write by a signed-in user, and any request at all by an
 * anonymous one, is now refused by the GRANT, before row-level security is
 * consulted. PostgREST answers that with an error whose code is `42501`
 * (permission denied), not with an empty result, and the tests below assert
 * the code so that a refusal which quietly went back to "zero rows matched"
 * would be noticed.
 *
 * The last block reads the catalog itself (the policy's role and text, the
 * TRUNCATE privilege, the sequence grants, the index), because none of those
 * can be seen through the REST API. See `catalog()` in `local-stack.ts`.
 */

type Row = { id: string; user_id: string; created_at: string; run: unknown };

const RUN_COLS = 'id, user_id, created_at, run';

/** PostgreSQL's `insufficient_privilege`: the role lacks the table grant. */
const PERMISSION_DENIED = '42501';

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

  it('SELECT: an anonymous visitor is refused outright, not answered with zero rows', async () => {
    const { data, error } = await anon.from('runs').select('id');

    expect(data ?? []).toEqual([]);
    // The grant is gone, so this is "permission denied", not an empty table.
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it('SELECT: an anonymous visitor cannot count the rows either', async () => {
    const { count, error } = await anon.from('runs').select('id', { count: 'exact', head: true });

    expect(count).toBeNull();
    expect(error).not.toBeNull();
  });

  // ── INSERT ──

  // F2. `runs_insert_own` is dropped and the INSERT grant revoked (0004).
  it('INSERT: the owner cannot insert a row for themselves (F2)', async () => {
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

  // ── UPDATE: there was never a policy, and since 0004 there is no grant ──

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

    // Nothing is returned as updated, whichever layer refused it.
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

  // F1. `runs_delete_own` is dropped and the DELETE grant revoked (0004).
  it('DELETE: the owner cannot delete their own row (F1)', async () => {
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

  // ── The grant layer: refused before row-level security is consulted ──

  it('a signed-in owner’s INSERT, UPDATE and DELETE are each answered "permission denied"', async () => {
    const row = await seed('owner-grant-layer');
    const before = await rowCount(owner.id);

    const added = await owner.client
      .from('runs')
      .insert({ user_id: owner.id, run: forged('owner-grant-insert') });
    const changed = await owner.client
      .from('runs')
      .update({ run: forged('owner-grant-update') })
      .eq('id', row.id);
    const removed = await owner.client.from('runs').delete().eq('id', row.id);

    expect(added.error?.code).toBe(PERMISSION_DENIED);
    expect(changed.error?.code).toBe(PERMISSION_DENIED);
    expect(removed.error?.code).toBe(PERMISSION_DENIED);
    expect(await truth(row.id)).toEqual(row);
    expect(await rowCount(owner.id)).toBe(before);
  });

  it('an anonymous visitor’s INSERT, UPDATE and DELETE are each answered "permission denied"', async () => {
    const row = await seed('anon-grant-layer');
    const before = await rowCount(owner.id);

    const added = await anon
      .from('runs')
      .insert({ user_id: owner.id, run: forged('anon-grant-insert') });
    const changed = await anon
      .from('runs')
      .update({ run: forged('anon-grant-update') })
      .eq('id', row.id);
    const removed = await anon.from('runs').delete().eq('id', row.id);

    expect(added.error?.code).toBe(PERMISSION_DENIED);
    expect(changed.error?.code).toBe(PERMISSION_DENIED);
    expect(removed.error?.code).toBe(PERMISSION_DENIED);
    expect(await truth(row.id)).toEqual(row);
    expect(await rowCount(owner.id)).toBe(before);
  });

  // ── The writer still writes ──

  it('the service role can still insert, select and delete a row', async () => {
    const before = await rowCount(owner.id);

    const row = await seed('service-role-round-trip');
    expect(await rowCount(owner.id)).toBe(before + 1);
    expect(await truth(row.id)).toEqual(row);

    const removed = await admin.from('runs').delete().eq('id', row.id).select('id');
    expect(removed.error).toBeNull();
    expect(removed.data).toEqual([{ id: row.id }]);
    expect(await truth(row.id)).toBeNull();
    expect(await rowCount(owner.id)).toBe(before);
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

/**
 * THE CATALOG, READ DIRECTLY.
 *
 * What migration 0004 promises and the REST API cannot show: the one policy
 * left on `public.runs`, its role and its predicate; the table privileges role
 * by role, TRUNCATE included (row-level security does not apply to TRUNCATE at
 * all, and PostgREST has no way to send one, so the grant is the only place it
 * can be checked); the grants on the rate-limit table's sequence; and the index
 * on `run_tokens(user_id)`. Read with psql inside the local stack's database
 * container: see `catalog()` in `local-stack.ts`.
 */
describe.runIf(RLS_LOCAL_STACK)('the catalog after migration 0004', STACK_TIMEOUT, () => {
  const PRIVILEGES = [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER',
  ] as const;

  /** The table privileges a role really holds on `public.runs`. */
  function held(role: string): string[] {
    const [row] = catalog(
      `select ${PRIVILEGES.map(
        (privilege) => `has_table_privilege('${role}', 'public.runs', '${privilege}')`,
      ).join(', ')};`,
    );
    const answers = (row ?? '').split('|');
    return PRIVILEGES.filter((_, index) => answers[index] === 't');
  }

  it('public.runs carries exactly one policy: an owner’s SELECT, for signed-in users only', () => {
    const policies = catalog(
      `select policyname, cmd, roles::text, coalesce(with_check, '') from pg_policies
       where schemaname = 'public' and tablename = 'runs' order by policyname;`,
    );

    expect(policies).toEqual(['runs_select_own|SELECT|{authenticated}|']);
  });

  it('the SELECT policy compares user_id to (select auth.uid()), evaluated once per statement', () => {
    const [qual] = catalog(
      `select qual from pg_policies
       where schemaname = 'public' and tablename = 'runs' and policyname = 'runs_select_own';`,
    );
    const predicate = (qual ?? '').toLowerCase().replace(/\s+/g, ' ');

    // Postgres stores it deparsed, as `(user_id = ( SELECT auth.uid() AS uid))`.
    expect(predicate).toMatch(/user_id = \( ?select auth\.uid\(\)( as uid)? ?\)/);
    // And there is no bare call left beside the wrapped one.
    expect(predicate.match(/auth\.uid\(\)/g)).toHaveLength(1);
  });

  it('row-level security is still on for public.runs', () => {
    expect(
      catalog(`select relrowsecurity from pg_class where oid = 'public.runs'::regclass;`),
    ).toEqual(['t']);
  });

  it('anon holds no privilege on public.runs, TRUNCATE included', () => {
    expect(held('anon')).toEqual([]);
  });

  it('authenticated holds SELECT on public.runs and nothing else, TRUNCATE included', () => {
    expect(held('authenticated')).toEqual(['SELECT']);
  });

  it('the service role still holds every privilege on public.runs', () => {
    expect(held('service_role')).toEqual([...PRIVILEGES]);
  });

  it('a TRUNCATE attempted as authenticated or anon is refused by the grant', () => {
    for (const role of ['authenticated', 'anon']) {
      // In a transaction that is rolled back either way, so a TRUNCATE that
      // wrongly succeeded would still destroy nothing.
      const [answer] = catalog(
        `begin;
         do $$
         begin
           set local role ${role};
           begin
             truncate public.runs;
             raise exception 'TRUNCATE was allowed for ${role}';
           exception when insufficient_privilege then
             null;
           end;
         end $$;
         rollback;
         select 'refused';`,
      );
      expect(answer).toBe('refused');
    }
  });

  it('neither browser role holds anything on the rate-limit sequence', () => {
    const rows = catalog(
      `select r,
              has_sequence_privilege(r, 'public.otp_rate_limit_hits_id_seq', 'USAGE'),
              has_sequence_privilege(r, 'public.otp_rate_limit_hits_id_seq', 'SELECT'),
              has_sequence_privilege(r, 'public.otp_rate_limit_hits_id_seq', 'UPDATE')
       from unnest(array['anon', 'authenticated', 'service_role']) r order by r;`,
    );

    // The service role makes every insert into that table and keeps its grant.
    expect(rows).toEqual(['anon|f|f|f', 'authenticated|f|f|f', 'service_role|t|t|t']);
  });

  it('run_tokens has an index on user_id', () => {
    const [definition] = catalog(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'run_tokens' and indexname = 'run_tokens_user_idx';`,
    );

    expect(definition ?? '').toMatch(/on public\.run_tokens using btree \(user_id\)/i);
  });
});
