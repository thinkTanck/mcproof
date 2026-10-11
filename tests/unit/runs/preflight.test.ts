import { ConfigError } from '@/config/env';
import { checkLiveRunPreflight } from '@/runs/preflight';

vi.mock('@/data/run-repository.factory', () => ({ getRunRepository: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminSupabase: vi.fn() }));

const NOW = new Date('2026-08-05T12:00:00.000Z');

/** Allowance 3, cap 5 — both gates configured, neither reached by default. */
const ENV = { LIVE_RUN_ALLOWANCE: '3', LIVE_RUN_SPEND_CAP: '5' };

/** The per-account count, recording whether it was consulted at all. */
function counter(count: number) {
  const calls: { userId: string; since: Date }[] = [];
  return {
    calls,
    countRunsSince: async (userId: string, since: Date) => {
      calls.push({ userId, since });
      return count;
    },
  };
}

/** The global period count, recording whether it was consulted at all. */
function meter(count: number) {
  const calls: Date[] = [];
  return {
    calls,
    countRunsSince: async (since: Date) => {
      calls.push(since);
      return count;
    },
  };
}

function preflight(overrides: {
  used?: number;
  spent?: number;
  env?: Record<string, string | undefined>;
}) {
  const repository = counter(overrides.used ?? 0);
  const spendMeter = meter(overrides.spent ?? 0);
  return {
    repository,
    meter: spendMeter,
    run: () =>
      checkLiveRunPreflight({
        userId: 'u1',
        now: NOW,
        env: overrides.env ?? ENV,
        repository,
        meter: spendMeter,
      }),
  };
}

describe('checkLiveRunPreflight — the one gate a live run passes before it costs anything', () => {
  it('allows a run when both gates are clear', async () => {
    const { run } = preflight({ used: 1, spent: 1 });
    await expect(run()).resolves.toEqual({ allowed: true });
  });

  it('consults BOTH gates on the clear path, so neither is decorative', async () => {
    const { repository, meter: m, run } = preflight({ used: 1, spent: 1 });
    await run();

    expect(repository.calls).toHaveLength(1);
    expect(m.calls).toHaveLength(1);
  });

  it('refuses an account that has spent its lifetime allowance', async () => {
    const { run } = preflight({ used: 3 });
    const decision = await run();

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.refusal.code).toBe('ALLOWANCE_EXHAUSTED');
    expect(decision.refusal.message).toContain('3 free live runs');
  });

  it('refuses every run once the global spend cap is reached', async () => {
    const { run } = preflight({ used: 0, spent: 5 });
    const decision = await run();

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.refusal.code).toBe('SPEND_CAP_REACHED');
    expect(decision.refusal.message.toLowerCase()).toContain('paused');
  });

  /**
   * ORDER AND COST. The per-account allowance is a single-account count served by
   * the `(user_id, created_at desc)` index; the spend meter is a privileged count
   * across every account's rows. A refused run must cost nothing, so the cheap
   * gate answers first and the expensive one is never reached.
   */
  it('short-circuits before the expensive gate when the cheap one already refuses', async () => {
    const { meter: m, run } = preflight({ used: 3, spent: 0 });
    await run();

    expect(m.calls).toHaveLength(0);
  });

  /** Cheapest of all is the config read, which costs no I/O at all. */
  it('validates configuration before it touches persistence', async () => {
    const {
      repository,
      meter: m,
      run,
    } = preflight({
      env: { LIVE_RUN_ALLOWANCE: '3', LIVE_RUN_SPEND_CAP: 'lots' },
    });

    await expect(run()).rejects.toThrow(ConfigError);
    expect(repository.calls).toHaveLength(0);
    expect(m.calls).toHaveLength(0);
  });

  it('passes the asking user to the per-account gate', async () => {
    const { repository, run } = preflight({});
    await run();

    expect(repository.calls[0]?.userId).toBe('u1');
  });

  it('counts the account from ACCOUNT CREATION when the instant is supplied', async () => {
    const repository = counter(0);
    await checkLiveRunPreflight({
      userId: 'u1',
      now: NOW,
      env: ENV,
      repository,
      meter: meter(0),
      accountCreatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(repository.calls[0]?.since.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  /** Time is injected, so the billing period is decided by the test and not the clock. */
  it('measures the spend cap over the injected instant, not the wall clock', async () => {
    const { meter: m } = preflight({});
    await checkLiveRunPreflight({
      userId: 'u1',
      now: new Date('2026-03-17T09:00:00.000Z'),
      env: ENV,
      repository: counter(0),
      meter: m,
    });

    expect(m.calls[0]?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });
});

/**
 * FAIL CLOSED. An unreadable spend control must refuse, not wave the run through:
 * the whole point of the backstop is the case where something is already wrong.
 */
describe('checkLiveRunPreflight — an unreadable spend control refuses', () => {
  it('refuses when the meter cannot be read', async () => {
    const decision = await checkLiveRunPreflight({
      userId: 'u1',
      now: NOW,
      env: ENV,
      repository: counter(0),
      meter: {
        countRunsSince: async () => {
          throw new Error('connection reset');
        },
      },
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.refusal.code).toBe('SPEND_CAP_REACHED');
  });

  it('refuses when there is no meter at all', async () => {
    const decision = await checkLiveRunPreflight({
      userId: 'u1',
      now: NOW,
      env: ENV,
      repository: counter(0),
      meter: null,
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.refusal.code).toBe('SPEND_CAP_REACHED');
  });

  /**
   * With no Supabase configured there is no shared run history to meter, so the
   * default meter resolves to nothing and the gate refuses. That is the honest
   * answer: we cannot show this run is inside the budget, so it does not start.
   */
  it('refuses when no meter can be resolved because persistence is unconfigured', async () => {
    const decision = await checkLiveRunPreflight({
      userId: 'u1',
      now: NOW,
      env: ENV,
      repository: counter(0),
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.refusal.code).toBe('SPEND_CAP_REACHED');
  });

  /**
   * A persistence OUTAGE is not a refusal. "The store is unreachable" is a
   * different answer from "you are out of runs", and the two-code refusal
   * vocabulary has no honest slot for it, so it propagates as a typed error for
   * the caller to surface. It still fails closed: no run starts either way.
   */
  it('propagates a per-account persistence failure rather than mislabelling it', async () => {
    await expect(
      checkLiveRunPreflight({
        userId: 'u1',
        now: NOW,
        env: ENV,
        repository: {
          countRunsSince: async () => {
            throw new Error('runs table unreachable');
          },
        },
        meter: meter(0),
      }),
    ).rejects.toThrow('runs table unreachable');
  });
});

/**
 * The refusal a user reads is DERIVED from configuration, never typed into copy.
 * The allowance and the sentence quoting it have drifted apart in this codebase
 * before (the OTP length), which is why this is asserted rather than reviewed.
 */
describe('checkLiveRunPreflight — refusal copy comes from config', () => {
  async function refusalFor(allowance: string): Promise<string> {
    const decision = await checkLiveRunPreflight({
      userId: 'u1',
      now: NOW,
      env: { LIVE_RUN_ALLOWANCE: allowance, LIVE_RUN_SPEND_CAP: '5' },
      repository: counter(50),
      meter: meter(0),
    });
    if (decision.allowed) return expect.unreachable('expected a refusal');
    return decision.refusal.message;
  }

  it('changes the words when the configured allowance changes', async () => {
    expect(await refusalFor('3')).toContain('3 free live runs');
    expect(await refusalFor('7')).toContain('7 free live runs');
  });

  it('says the singular when the allowance is one', async () => {
    expect(await refusalFor('1')).toContain('1 free live run');
  });

  it('states the zero case as words rather than a bare numeral', async () => {
    expect(await refusalFor('0')).toContain('no free live runs');
  });

  it('carries no em dash in either refusal', async () => {
    const allowance = await refusalFor('3');
    const cap = await checkLiveRunPreflight({
      userId: 'u1',
      now: NOW,
      env: ENV,
      repository: counter(0),
      meter: meter(5),
    });

    expect(allowance).not.toContain('—');
    if (cap.allowed) return expect.unreachable('expected a refusal');
    expect(cap.refusal.message).not.toContain('—');
  });
});

/**
 * The default resolution path. Callers hand this nothing but a user id, so the
 * seam has to find its own repository and meter, and both must come from the
 * same places the rest of the app uses.
 */
describe('checkLiveRunPreflight — resolving its own dependencies', () => {
  const SUPABASE_ENV = {
    ...ENV,
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the per-account count through the app run repository when none is injected', async () => {
    const { getRunRepository } = await import('@/data/run-repository.factory');
    const repository = counter(3);
    vi.mocked(getRunRepository).mockResolvedValue(
      repository as unknown as Awaited<ReturnType<typeof getRunRepository>>,
    );

    const decision = await checkLiveRunPreflight({ userId: 'u1', now: NOW, env: ENV });

    expect(getRunRepository).toHaveBeenCalled();
    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.refusal.code).toBe('ALLOWANCE_EXHAUSTED');
  });

  it('meters the global period through the service-role client when none is injected', async () => {
    const { getRunRepository } = await import('@/data/run-repository.factory');
    const { createAdminSupabase } = await import('@/lib/supabase/server');
    vi.mocked(getRunRepository).mockResolvedValue(
      counter(0) as unknown as Awaited<ReturnType<typeof getRunRepository>>,
    );
    const gte = vi.fn().mockResolvedValue({ count: 5, error: null });
    vi.mocked(createAdminSupabase).mockReturnValue({
      from: () => ({ select: () => ({ gte }) }),
    } as unknown as ReturnType<typeof createAdminSupabase>);

    const decision = await checkLiveRunPreflight({ userId: 'u1', now: NOW, env: SUPABASE_ENV });

    expect(gte).toHaveBeenCalledWith('created_at', '2026-08-01T00:00:00.000Z');
    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.refusal.code).toBe('SPEND_CAP_REACHED');
  });

  it('allows the run when the resolved dependencies both clear', async () => {
    const { getRunRepository } = await import('@/data/run-repository.factory');
    const { createAdminSupabase } = await import('@/lib/supabase/server');
    vi.mocked(getRunRepository).mockResolvedValue(
      counter(0) as unknown as Awaited<ReturnType<typeof getRunRepository>>,
    );
    vi.mocked(createAdminSupabase).mockReturnValue({
      // Two reads: every run in the period, then the discarded ones the meter
      // subtracts (the second adds one `eq`). Both answer none here.
      from: () => ({
        select: () => ({
          gte: () =>
            Object.assign(Promise.resolve({ count: 0, error: null }), {
              eq: () => Promise.resolve({ count: 0, error: null }),
            }),
        }),
      }),
    } as unknown as ReturnType<typeof createAdminSupabase>);

    await expect(
      checkLiveRunPreflight({ userId: 'u1', now: NOW, env: SUPABASE_ENV }),
    ).resolves.toEqual({ allowed: true });
  });

  it('refuses when the admin client is unavailable even though Supabase is configured', async () => {
    const { getRunRepository } = await import('@/data/run-repository.factory');
    const { createAdminSupabase } = await import('@/lib/supabase/server');
    vi.mocked(getRunRepository).mockResolvedValue(
      counter(0) as unknown as Awaited<ReturnType<typeof getRunRepository>>,
    );
    vi.mocked(createAdminSupabase).mockReturnValue(null);

    const decision = await checkLiveRunPreflight({ userId: 'u1', now: NOW, env: SUPABASE_ENV });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.refusal.code).toBe('SPEND_CAP_REACHED');
  });
});
