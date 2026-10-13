import { getDiscardedRunStore } from '@/data/discarded-run-store.factory';
import { getRunRepository } from '@/data/run-repository.factory';
import { InMemoryRunRepository } from '@/data/run-repository';
import { SupabaseRunReader, SupabaseRunRepository } from '@/data/run-repository.supabase';
import { createServerSupabase } from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn() }));

describe('getRunRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it('returns the in-memory adapter when auth is not configured', async () => {
    expect(await getRunRepository()).toBeInstanceOf(InMemoryRunRepository);
  });

  it('returns the Supabase reader (RLS) when auth is configured', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    vi.mocked(createServerSupabase).mockResolvedValue({ from: () => ({}) } as never);
    expect(await getRunRepository()).toBeInstanceOf(SupabaseRunReader);
  });
});

/**
 * A BROWSER SESSION'S IDENTITY READS RUNS AND WRITES NONE.
 *
 * Both cookie-bound factories hand out the reader. It is not the write-capable
 * adapter with its inserts hidden behind a type: the methods are not there, so
 * nothing holding a session client can insert a run whatever it is cast to.
 */
describe('what the cookie-bound factories hand out cannot write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    vi.mocked(createServerSupabase).mockResolvedValue({ from: () => ({}) } as never);
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it('getRunRepository() has no saveRun and is not the write-capable adapter', async () => {
    const repository = await getRunRepository();

    expect(repository).not.toBeInstanceOf(SupabaseRunRepository);
    expect('saveRun' in repository).toBe(false);
    expect('saveDiscardedRun' in repository).toBe(false);
  });

  it('getDiscardedRunStore() has no saveDiscardedRun and is not the write-capable adapter', async () => {
    const store = await getDiscardedRunStore();

    expect(store).toBeInstanceOf(SupabaseRunReader);
    expect(store).not.toBeInstanceOf(SupabaseRunRepository);
    expect('saveDiscardedRun' in store).toBe(false);
    expect('saveRun' in store).toBe(false);
  });

  it('the reader itself carries no insert, and the repository carries exactly two', () => {
    const own = (proto: object) => Object.getOwnPropertyNames(proto).filter((n) => /^save/.test(n));

    expect(own(SupabaseRunReader.prototype)).toEqual([]);
    expect(own(SupabaseRunRepository.prototype).sort()).toEqual(['saveDiscardedRun', 'saveRun']);
  });
});
