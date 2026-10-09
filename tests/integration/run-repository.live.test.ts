import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRunRepository } from '@/data/run-repository.supabase';
import { getDataSource } from '@/data/source';
import type { RunResult } from '@/contract';

/**
 * Live end-to-end check of SupabaseRunRepository against a REAL Supabase project
 * (the `runs` table + RLS). Gated on Supabase creds, so it SKIPS in CI and normal
 * unit runs (no secrets there) and only executes when the env is loaded from
 * .env.local. Self-cleaning: it provisions two throwaway auth users and deletes
 * them (cascading their rows) afterwards.
 *
 * It proves: (1) an owner can save/read/count their runs through the adapter, and
 * (2) Row-Level Security isolates users — a second user can neither read nor
 * delete the first user's rows, while the owner can.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = Boolean(URL && ANON && SERVICE);

describe.runIf(LIVE)('SupabaseRunRepository — live Supabase + RLS isolation', () => {
  // NOTE: `describe.runIf` still EXECUTES this body to collect specs, so the
  // admin client is built lazily in beforeAll (which does NOT run when skipped) —
  // otherwise `createClient` throws "supabaseUrl is required" during collection
  // in the credential-free CI/unit environment.
  let admin: SupabaseClient;

  let run: RunResult;
  let userA = { id: '' };
  let userB = { id: '' };
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let repoA: SupabaseRunRepository;
  let repoB: SupabaseRunRepository;
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
    const sample = await getDataSource().getRun('sample');
    if (!sample) throw new Error('sample run missing');
    run = sample;
    const a = await provision('a');
    userA = { id: a.id };
    clientA = a.client;
    repoA = new SupabaseRunRepository(clientA);
    const b = await provision('b');
    userB = { id: b.id };
    clientB = b.client;
    repoB = new SupabaseRunRepository(clientB);
  }, 40000);

  afterAll(async () => {
    // Deleting the users cascades their runs (FK on delete cascade).
    if (userA.id) await admin.auth.admin.deleteUser(userA.id);
    if (userB.id) await admin.auth.admin.deleteUser(userB.id);
  }, 40000);

  it('owner: save → read → count → list a run', async () => {
    const stored = await repoA.saveRun(userA.id, run);
    rowId = stored.id;
    expect(stored.userId).toBe(userA.id);
    expect(stored.run).toEqual(run);

    expect(await repoA.getRun(userA.id, rowId)).toMatchObject({ id: rowId, userId: userA.id });
    expect(await repoA.countRunsSince(userA.id, new Date(Date.now() - 60_000))).toBe(1);
    expect((await repoA.listRuns(userA.id)).map((r) => r.id)).toEqual([rowId]);
  });

  it('RLS: a second user cannot READ the first user’s rows', async () => {
    // Purest RLS check: user B selecting ALL runs never sees A's row.
    const { data } = await clientB.from('runs').select('id');
    expect((data ?? []).some((r) => r.id === rowId)).toBe(false);

    // And through the adapter: asking for A's row as B → null; B's own views empty.
    expect(await repoB.getRun(userA.id, rowId)).toBeNull();
    expect(await repoB.listRuns(userB.id)).toEqual([]);
    expect(await repoB.countRunsSince(userB.id, new Date(0))).toBe(0);
  });

  it('RLS: a second user cannot DELETE the first user’s rows; the owner can', async () => {
    // B attempts to delete A's row — RLS blocks it, the row survives.
    await clientB.from('runs').delete().eq('id', rowId);
    expect(await repoA.getRun(userA.id, rowId)).not.toBeNull();

    // The owner deletes their own row — RLS allows it, the row is gone.
    const { error } = await clientA.from('runs').delete().eq('id', rowId);
    expect(error).toBeNull();
    expect(await repoA.getRun(userA.id, rowId)).toBeNull();
  });
});
