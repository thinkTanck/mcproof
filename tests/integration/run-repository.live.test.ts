import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRunReader, SupabaseRunRepository } from '@/data/run-repository.supabase';
import { getDataSource } from '@/data/source';
import type { RunResult } from '@/contract';

/**
 * Live end-to-end check of the Supabase run adapters against a REAL Supabase
 * project (the `runs` table + RLS). Gated on Supabase creds, so it SKIPS in CI
 * and normal unit runs (no secrets there) and only executes when the env is
 * loaded from .env.local. Self-cleaning: it provisions two throwaway auth users
 * and deletes them (cascading their rows) afterwards.
 *
 * It proves: (1) a row written with the SERVICE ROLE, which is how the app
 * writes every run (`src/runs/run-writes.ts`), is read, counted and listed by
 * its owner through the owner's own session, and (2) Row-Level Security isolates
 * users: a second user can neither read nor delete the first user's rows.
 *
 * It asserts nothing about whether an owner may insert or delete their own rows
 * directly. The app does neither, so this test holds before and after those two
 * policies are dropped; what a user can do to the table with no app in the way
 * is `tests/integration/rls/runs-rls.test.ts`, against a local stack.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = Boolean(URL && ANON && SERVICE);

/** Real round trips to a real database: the default five seconds is too tight. */
const T = { timeout: 30_000 } as const;

describe.runIf(LIVE)('Supabase run adapters: live Supabase + RLS isolation', T, () => {
  // NOTE: `describe.runIf` still EXECUTES this body to collect specs, so the
  // admin client is built lazily in beforeAll (which does NOT run when skipped) —
  // otherwise `createClient` throws "supabaseUrl is required" during collection
  // in the credential-free CI/unit environment.
  let admin: SupabaseClient;

  let run: RunResult;
  let userA = { id: '' };
  let userB = { id: '' };
  let clientB: SupabaseClient;
  /** The write side: service role, as the app writes. */
  let writer: SupabaseRunRepository;
  /** The read side: each user's own session, as the app reads. */
  let readerA: SupabaseRunReader;
  let readerB: SupabaseRunReader;
  let rowId = '';

  const provision = async (tag: string) => {
    const email = `mcproof-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${tag}@example.com`;
    const password = `Pw!${Math.random().toString(36).slice(2)}${Date.now()}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser(${tag}): ${error?.message}`);
    const client = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`signIn(${tag}): ${signInErr.message}`);
    return { id: data.user.id, client };
  };

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    writer = new SupabaseRunRepository(admin);
    const sample = await getDataSource().getRun('sample');
    if (!sample) throw new Error('sample run missing');
    run = sample;
    const a = await provision('a');
    userA = { id: a.id };
    readerA = new SupabaseRunReader(a.client);
    const b = await provision('b');
    userB = { id: b.id };
    clientB = b.client;
    readerB = new SupabaseRunReader(clientB);
  }, 40000);

  afterAll(async () => {
    // Deleting the users cascades their runs (FK on delete cascade).
    if (userA.id) await admin.auth.admin.deleteUser(userA.id);
    if (userB.id) await admin.auth.admin.deleteUser(userB.id);
  }, 40000);

  it('a row written with the service role is read, counted and listed by its owner', async () => {
    const stored = await writer.saveRun(userA.id, run);
    rowId = stored.id;
    expect(stored.userId).toBe(userA.id);
    expect(stored.run).toEqual(run);

    expect(await readerA.getRun(userA.id, rowId)).toMatchObject({ id: rowId, userId: userA.id });
    expect(await readerA.countRunsSince(userA.id, new Date(Date.now() - 60_000))).toBe(1);
    expect((await readerA.listRuns(userA.id)).map((r) => r.id)).toEqual([rowId]);
  });

  it('RLS: a second user cannot READ the first user’s rows', async () => {
    // Purest RLS check: user B selecting ALL runs never sees A's row.
    const { data } = await clientB.from('runs').select('id');
    expect((data ?? []).some((r) => r.id === rowId)).toBe(false);

    // And through the adapter: asking for A's row as B → null; B's own views empty.
    expect(await readerB.getRun(userA.id, rowId)).toBeNull();
    expect(await readerB.listRuns(userB.id)).toEqual([]);
    expect(await readerB.countRunsSince(userB.id, new Date(0))).toBe(0);
  });

  it('RLS: a second user cannot DELETE the first user’s rows', async () => {
    // B attempts to delete A's row — RLS blocks it, the row survives.
    await clientB.from('runs').delete().eq('id', rowId);
    expect(await readerA.getRun(userA.id, rowId)).not.toBeNull();
  });
});
