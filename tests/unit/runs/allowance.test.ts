import {
  LiveRunAllowanceError,
  checkLiveRunAllowance,
  describeLiveRunAllowance,
} from '@/runs/allowance';
import { InMemoryRunRepository } from '@/data/run-repository';
import { getDataSource } from '@/data/source';
import type { RunResult } from '@/contract';

/** The persisted payload binds to the real sample RunResult, never a literal. */
async function sampleRun(): Promise<RunResult> {
  const run = await getDataSource().getRun('sample');
  if (!run) throw new Error('sample run missing');
  return run;
}

/**
 * A `countRunsSince` stub that records what it was asked, so the LIFETIME
 * semantics can be asserted on the query itself and not only on the answer.
 */
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

const ENV_3 = { LIVE_RUN_ALLOWANCE: '3' };

describe('checkLiveRunAllowance — the per-account LIFETIME free allowance (ADR-0007)', () => {
  it('allows a run while the account is under its allowance, and reports what is left', async () => {
    const repository = counter(1);
    const decision = await checkLiveRunAllowance({ repository, userId: 'u1', env: ENV_3 });

    expect(decision.allowed).toBe(true);
    expect(decision).toMatchObject({ allowance: 3, used: 1, remaining: 2 });
  });

  it('allows the LAST run of the allowance (the boundary is used < allowance)', async () => {
    const decision = await checkLiveRunAllowance({
      repository: counter(2),
      userId: 'u1',
      env: ENV_3,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(1);
  });

  it('refuses once the allowance is spent, with a TYPED error rather than a raw throw', async () => {
    const decision = await checkLiveRunAllowance({
      repository: counter(3),
      userId: 'u1',
      env: ENV_3,
    });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return expect.unreachable('expected a refusal');
    expect(decision.error).toBeInstanceOf(LiveRunAllowanceError);
    expect(decision.error.name).toBe('LiveRunAllowanceError');
    expect(decision.error.code).toBe('ALLOWANCE_EXHAUSTED');
    expect(decision.error.allowance).toBe(3);
    expect(decision.error.used).toBe(3);
    expect(decision.remaining).toBe(0);
  });

  it('never reports negative remaining when a count somehow overshoots', async () => {
    const decision = await checkLiveRunAllowance({
      repository: counter(9),
      userId: 'u1',
      env: ENV_3,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  /** 0 is the operator's "free live runs are off" switch, not a misconfiguration. */
  it('refuses every run when the allowance is configured to zero', async () => {
    const decision = await checkLiveRunAllowance({
      repository: counter(0),
      userId: 'u1',
      env: { LIVE_RUN_ALLOWANCE: '0' },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  it('scopes the count to the asking user', async () => {
    const repository = counter(0);
    await checkLiveRunAllowance({ repository, userId: 'user-42', env: ENV_3 });

    expect(repository.calls[0]?.userId).toBe('user-42');
  });

  /**
   * LIFETIME, not a rolling window. The removed `LIVE_RUN_CAP` /
   * `LIVE_RUN_WINDOW_HOURS` pair counted from `now - windowHours`, so an
   * exhausted account simply came back tomorrow and the operator's per-user
   * exposure was unbounded. ADR-0007 supersedes it: the bound is a TOTAL, so the
   * count starts at account creation and never moves.
   */
  it('counts from ACCOUNT CREATION, not from a rolling window boundary', async () => {
    const repository = counter(0);
    const accountCreatedAt = '2026-01-01T00:00:00.000Z';
    await checkLiveRunAllowance({ repository, userId: 'u1', accountCreatedAt, env: ENV_3 });

    expect(repository.calls[0]?.since.toISOString()).toBe(accountCreatedAt);
  });

  it('accepts the account creation instant as a Date as well as an ISO string', async () => {
    const repository = counter(0);
    const accountCreatedAt = new Date('2026-01-01T00:00:00.000Z');
    await checkLiveRunAllowance({ repository, userId: 'u1', accountCreatedAt, env: ENV_3 });

    expect(repository.calls[0]?.since.getTime()).toBe(accountCreatedAt.getTime());
  });

  /**
   * A run cannot predate its owner's account, so counting from the epoch is the
   * same total — and it is the SAFE default, because it can only ever over-count,
   * never let a spent allowance through.
   */
  it.each([undefined, null, 'not a date'])(
    'falls back to the epoch when the creation instant is %s',
    async (accountCreatedAt) => {
      const repository = counter(0);
      await checkLiveRunAllowance({
        repository,
        userId: 'u1',
        accountCreatedAt: accountCreatedAt as string | null | undefined,
        env: ENV_3,
      });

      expect(repository.calls[0]?.since.getTime()).toBe(0);
    },
  );

  it('reads the allowance from config, so the gate moves with the environment', async () => {
    const decision = await checkLiveRunAllowance({
      repository: counter(3),
      userId: 'u1',
      env: { LIVE_RUN_ALLOWANCE: '5' },
    });

    expect(decision.allowed).toBe(true);
    expect(decision).toMatchObject({ allowance: 5, remaining: 2 });
  });

  it('works against the real repository adapter, counting only the caller’s rows', async () => {
    const repository = new InMemoryRunRepository();
    const run = await sampleRun();
    await repository.saveRun('mine', run);
    await repository.saveRun('mine', run);
    await repository.saveRun('someone-else', run);

    const mine = await checkLiveRunAllowance({ repository, userId: 'mine', env: ENV_3 });
    const theirs = await checkLiveRunAllowance({ repository, userId: 'nobody', env: ENV_3 });

    expect(mine).toMatchObject({ allowed: true, used: 2, remaining: 1 });
    expect(theirs).toMatchObject({ allowed: true, used: 0, remaining: 3 });
  });
});

describe('LiveRunAllowanceError — copy the UI can state plainly', () => {
  it('derives its sentence from the configured allowance, with no numeral of its own', () => {
    expect(new LiveRunAllowanceError(3, 3).message).toContain('3 free live runs');
    expect(new LiveRunAllowanceError(7, 7).message).toContain('7 free live runs');
  });

  it('says the singular when the allowance is one', () => {
    expect(new LiveRunAllowanceError(1, 1).message).toContain('1 free live run');
    expect(new LiveRunAllowanceError(1, 1).message).not.toContain('runs');
  });

  it('points at the path that still works instead of dead-ending', () => {
    expect(new LiveRunAllowanceError(3, 3).message.toLowerCase()).toContain('sample');
  });

  it('never asserts a usage number, because the number it has is the ceiling', () => {
    // The sentence used to read "You have used 20 free live runs", where 20 was
    // the configured allowance, not the count. On the one production account
    // that number was 192, so the sentence was false whenever usage exceeded the
    // limit. The refusal states the limit it enforces and nothing about usage.
    const message = new LiveRunAllowanceError(20, 192).message;
    expect(message).not.toMatch(/you have used/i);
    expect(message).not.toContain('192');
    expect(message).toMatch(/reached/i);
    expect(message).toContain('20 free live runs');
  });

  it('states the zero case as a switched-off allowance, not a reached limit of nothing', () => {
    const message = new LiveRunAllowanceError(0, 0).message;
    expect(message).toContain('no free live runs');
    expect(message).not.toMatch(/limit of no/i);
  });

  /** UI copy rule: no em dashes. */
  it('carries no em dash', () => {
    expect(new LiveRunAllowanceError(3, 3).message).not.toContain('—');
  });

  it('is a real Error, so it survives being thrown and caught', () => {
    const error = new LiveRunAllowanceError(3, 3);
    expect(error).toBeInstanceOf(Error);
    expect(() => {
      throw error;
    }).toThrow(LiveRunAllowanceError);
  });
});

describe('describeLiveRunAllowance — the number reaches copy only through here', () => {
  it.each([
    [3, '3 free live runs'],
    [5, '5 free live runs'],
  ])('renders %i as "%s"', (allowance, expected) => {
    expect(describeLiveRunAllowance(allowance)).toBe(expected);
  });

  it('renders a single run in the singular', () => {
    expect(describeLiveRunAllowance(1)).toBe('1 free live run');
  });

  it('states the zero case as words rather than a bare "0 free live runs"', () => {
    expect(describeLiveRunAllowance(0)).toBe('no free live runs');
  });

  it('reads the configured value when handed none', () => {
    expect(describeLiveRunAllowance(undefined, { LIVE_RUN_ALLOWANCE: '4' })).toBe(
      '4 free live runs',
    );
  });

  it('carries no em dash', () => {
    expect(describeLiveRunAllowance(3)).not.toContain('—');
  });
});
