/**
 * THE PRODUCTION WIRING of the live-run pipeline: which real module each seam of
 * `createLiveRunHost` is bound to, and the process-local registry that records
 * what this instance has observed about a run.
 *
 * The pipeline's own behaviour is tested in `tests/unit/runs/live-run.test.ts`.
 * What is asserted here is only that the seams point at the real things: the
 * gate is `checkLiveRunPreflight`, WRITES go through the session run writer
 * (`src/runs/run-writes.ts`, service-role, owner checked in code), READS stay on
 * the RLS-scoped `getRunRepository()`, the judge is `resolveLiveDetector()`, and
 * the token store and open-run registry are the ones
 * `src/runs/live-run-stores.factory.ts` picks — which is what makes a run outlive
 * the instance that started it.
 */
import type { RunResult } from '@/contract';
import { checkLiveRunPreflight } from '@/runs/preflight';
import { getDiscardedRunStore } from '@/data/discarded-run-store.factory';
import { getRunRepository } from '@/data/run-repository.factory';
import { resolveLiveDetector } from '@/detector/resolve';
import { getLiveRunSessionStore, getRunTokenStore } from '@/runs/live-run-stores.factory';
import { getSessionRunWriter } from '@/runs/run-writes';
import {
  getLiveRunHost,
  liveRunDeps,
  noteAgentRequest,
  noteRunFinished,
  readAgentActivity,
  readRunFinishedAt,
  resetLiveRunRegistry,
} from '@/app/api/mcp/host';

vi.mock('@/runs/preflight', () => ({ checkLiveRunPreflight: vi.fn() }));
vi.mock('@/data/run-repository.factory', () => ({ getRunRepository: vi.fn() }));
vi.mock('@/data/discarded-run-store.factory', () => ({ getDiscardedRunStore: vi.fn() }));
vi.mock('@/runs/run-writes', () => ({ getSessionRunWriter: vi.fn() }));
vi.mock('@/detector/resolve', () => ({ resolveLiveDetector: vi.fn() }));
vi.mock('@/runs/live-run-stores.factory', () => ({
  getRunTokenStore: vi.fn(),
  getLiveRunSessionStore: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetLiveRunRegistry();
});

describe('the live-run host wiring', () => {
  it('is one host per process, so a run keeps the instance that started it', () => {
    expect(getLiveRunHost()).toBe(getLiveRunHost());
  });

  it('binds the gate to checkLiveRunPreflight, clock and all', async () => {
    vi.mocked(checkLiveRunPreflight).mockResolvedValue({ allowed: true });
    const at = new Date('2026-08-05T10:00:00.000Z');
    await expect(liveRunDeps().preflight({ userId: 'user-1', now: at })).resolves.toEqual({
      allowed: true,
    });
    expect(checkLiveRunPreflight).toHaveBeenCalledWith({ userId: 'user-1', now: at });
  });

  it('relays a gate refusal rather than deciding one of its own', async () => {
    vi.mocked(checkLiveRunPreflight).mockResolvedValue({
      allowed: false,
      refusal: { code: 'ALLOWANCE_EXHAUSTED', message: 'no runs left' },
    });
    await expect(liveRunDeps().preflight({ userId: 'user-1' })).resolves.toEqual({
      allowed: false,
      refusal: { code: 'ALLOWANCE_EXHAUSTED', message: 'no runs left' },
    });
  });

  it('persists a result through the session run writer, resolved per call', async () => {
    const saveRun = vi.fn().mockResolvedValue({ id: 'row-1' });
    vi.mocked(getSessionRunWriter).mockReturnValue({ saveRun, saveDiscardedRun: vi.fn() });
    const run = { runId: 'r1' } as unknown as RunResult;

    await expect(liveRunDeps().repository.saveRun('user-1', run)).resolves.toEqual({ id: 'row-1' });
    expect(getSessionRunWriter).toHaveBeenCalledTimes(1);
    expect(saveRun).toHaveBeenCalledWith('user-1', run);
    // The caller's cookie-bound repository is never asked to write.
    expect(getRunRepository).not.toHaveBeenCalled();
  });

  it('persists a discard marker through the session run writer too', async () => {
    const saveDiscardedRun = vi.fn().mockResolvedValue({ id: 'row-2' });
    vi.mocked(getSessionRunWriter).mockReturnValue({ saveRun: vi.fn(), saveDiscardedRun });
    const marker = { discarded: true, runId: 'r1' } as never;

    await expect(liveRunDeps().repository.saveDiscardedRun?.('user-1', marker)).resolves.toEqual({
      id: 'row-2',
    });
    expect(saveDiscardedRun).toHaveBeenCalledWith('user-1', marker);
    expect(getDiscardedRunStore).not.toHaveBeenCalled();
  });

  it('keeps the two reads on the owner-scoped session repository', async () => {
    const findByRunId = vi.fn().mockResolvedValue(null);
    const findDiscardedByRunId = vi.fn().mockResolvedValue(null);
    vi.mocked(getRunRepository).mockResolvedValue({ findByRunId } as never);
    vi.mocked(getDiscardedRunStore).mockResolvedValue({ findDiscardedByRunId } as never);
    const { repository } = liveRunDeps();

    await repository.findByRunId?.('user-1', 'r1');
    await repository.findDiscardedByRunId?.('user-1', 'r1');

    expect(findByRunId).toHaveBeenCalledWith('user-1', 'r1');
    expect(findDiscardedByRunId).toHaveBeenCalledWith('user-1', 'r1');
    expect(getSessionRunWriter).not.toHaveBeenCalled();
  });

  it('resolves the judge through resolveLiveDetector, so an unconfigured judge is null', () => {
    vi.mocked(resolveLiveDetector).mockReturnValue(null);
    expect(liveRunDeps().resolveDetector()).toBeNull();
    expect(resolveLiveDetector).toHaveBeenCalled();
  });
});

/**
 * THE WIRING THIS MODULE EXISTS FOR.
 *
 * The durable adapters shipped tested and with no production caller, so a run
 * still belonged to the instance that started it and the reaper read an empty
 * registry. These assertions are the join: every token read and every registry
 * write goes through the factory, which picks Supabase whenever Supabase is
 * configured and the in-memory adapter otherwise.
 */
describe('the live-run host is wired to the durable stores', () => {
  const tokens = {
    save: vi.fn().mockResolvedValue(undefined),
    findBySelector: vi.fn().mockResolvedValue(null),
    endRun: vi.fn().mockResolvedValue(undefined),
  };
  const sessions = {
    create: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockResolvedValue(null),
    appendEvents: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn().mockResolvedValue(true),
    findStale: vi.fn().mockResolvedValue([]),
    sweepExpired: vi.fn().mockResolvedValue(0),
  };

  beforeEach(() => {
    vi.mocked(getRunTokenStore).mockReturnValue(tokens);
    vi.mocked(getLiveRunSessionStore).mockReturnValue(sessions);
  });

  it('writes, reads and revokes run tokens through the store factory', async () => {
    const deps = liveRunDeps();
    const record = { selector: 'sel' } as never;
    const endedAt = new Date('2026-08-05T10:00:00.000Z');

    await deps.tokens.save(record);
    await deps.tokens.findBySelector('sel');
    await deps.tokens.endRun('run-1', endedAt);

    expect(tokens.save).toHaveBeenCalledWith(record);
    expect(tokens.findBySelector).toHaveBeenCalledWith('sel');
    expect(tokens.endRun).toHaveBeenCalledWith('run-1', endedAt);
  });

  it('keeps the open-run registry in the durable store, not in the process', async () => {
    const deps = liveRunDeps();
    expect(deps.sessions).toBeDefined();
    const at = new Date('2026-08-05T10:00:00.000Z');

    await deps.sessions?.find('run-1');
    await deps.sessions?.finish('run-1', at);

    expect(sessions.find).toHaveBeenCalledWith('run-1');
    expect(sessions.finish).toHaveBeenCalledWith('run-1', at);
  });

  it('resolves the store on every call, so the running config decides, not import order', async () => {
    const deps = liveRunDeps();
    await deps.tokens.findBySelector('one');
    await deps.tokens.findBySelector('two');

    expect(getRunTokenStore).toHaveBeenCalledTimes(2);
  });

  it('returns what the durable store returns, rather than a value of its own', async () => {
    const record = { selector: 'sel', runId: 'run-1' };
    tokens.findBySelector.mockResolvedValueOnce(record);

    await expect(liveRunDeps().tokens.findBySelector('sel')).resolves.toEqual(record);
  });
});

describe('the run observation registry', () => {
  it('knows nothing about a run no agent has reached', () => {
    expect(readAgentActivity('run-1')).toBeNull();
    expect(readRunFinishedAt('run-1')).toBeNull();
  });

  it('records the first and last authenticated request, and counts them', () => {
    noteAgentRequest('run-1', new Date('2026-08-05T10:00:00.000Z'));
    noteAgentRequest('run-1', new Date('2026-08-05T10:00:05.000Z'));
    expect(readAgentActivity('run-1')).toEqual({
      connectedAt: '2026-08-05T10:00:00.000Z',
      lastSeenAt: '2026-08-05T10:00:05.000Z',
      requests: 2,
    });
  });

  it('keeps runs apart', () => {
    noteAgentRequest('run-1', new Date('2026-08-05T10:00:00.000Z'));
    expect(readAgentActivity('run-2')).toBeNull();
  });

  it('stamps a finished run once, and the first stamp stands', () => {
    noteRunFinished('run-1', new Date('2026-08-05T11:00:00.000Z'));
    noteRunFinished('run-1', new Date('2026-08-05T12:00:00.000Z'));
    expect(readRunFinishedAt('run-1')).toBe('2026-08-05T11:00:00.000Z');
  });
});
