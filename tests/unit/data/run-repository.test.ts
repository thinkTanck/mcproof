import { InMemoryRunRepository } from '@/data/run-repository';
import { getDataSource } from '@/data/source';
import type { RunResult } from '@/contract';

/** The persisted payload binds to the real sample RunResult, never a literal. */
async function sampleRun(): Promise<RunResult> {
  const run = await getDataSource().getRun('sample');
  if (!run) throw new Error('sample run missing');
  return run;
}

describe('InMemoryRunRepository', () => {
  it('saves a run and returns a stored row owned by the user', async () => {
    const repo = new InMemoryRunRepository();
    const run = await sampleRun();
    const stored = await repo.saveRun('user-1', run);

    expect(stored.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.userId).toBe('user-1');
    expect(stored.run).toEqual(run);
    expect(Number.isNaN(Date.parse(stored.createdAt))).toBe(false);
  });

  it('reads a run for its owner; null for another user (RLS-style isolation) or a missing id', async () => {
    const repo = new InMemoryRunRepository();
    const stored = await repo.saveRun('owner', await sampleRun());

    expect(await repo.getRun('owner', stored.id)).toEqual(stored);
    expect(await repo.getRun('intruder', stored.id)).toBeNull();
    expect(await repo.getRun('owner', 'no-such-id')).toBeNull();
  });

  it('lists only the user’s own runs, newest first', async () => {
    const repo = new InMemoryRunRepository();
    const run = await sampleRun();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const older = await repo.saveRun('u', run);
      vi.setSystemTime(new Date('2026-01-01T00:00:05Z'));
      const newer = await repo.saveRun('u', run);
      await repo.saveRun('other', run);

      const list = await repo.listRuns('u');
      expect(list.map((r) => r.id)).toEqual([newer.id, older.id]); // newest first
      expect(list.every((r) => r.userId === 'u')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts the user’s runs since a timestamp (cap accounting), excluding other users', async () => {
    const repo = new InMemoryRunRepository();
    const run = await sampleRun();
    const before = new Date(Date.now() - 1000);
    await repo.saveRun('u', run);
    await repo.saveRun('u', run);
    await repo.saveRun('other', run);

    expect(await repo.countRunsSince('u', before)).toBe(2);
    expect(await repo.countRunsSince('u', new Date(Date.now() + 60_000))).toBe(0);
  });
});

describe('InMemoryRunRepository: finding a saved run by the run id it was hosted under', () => {
  it('finds the saved run of its owner by the run id inside the result', async () => {
    const repo = new InMemoryRunRepository();
    const run = await sampleRun();
    const stored = await repo.saveRun('owner', run);

    expect(await repo.findByRunId('owner', run.runId)).toEqual(stored);
  });

  it('returns null for another user and for a run id nothing was saved under', async () => {
    const repo = new InMemoryRunRepository();
    const run = await sampleRun();
    await repo.saveRun('owner', run);

    expect(await repo.findByRunId('intruder', run.runId)).toBeNull();
    expect(await repo.findByRunId('owner', 'no-such-run')).toBeNull();
  });
});
