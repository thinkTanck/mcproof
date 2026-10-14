/**
 * THE ONE MODULE THAT WRITES `public.runs` (`src/runs/run-writes.ts`).
 *
 * A signed-in browser used to insert its own run rows: the finish and the
 * discard both wrote through the caller's cookie session, which only works
 * while `public.runs` lets its owner insert. That same grant lets anyone holding
 * the public key insert rows the app never produced, or delete the ones it did.
 * So every write now goes through one server-only module on the service-role
 * client, and the database grant can be taken away.
 *
 * The service role skips Row-Level Security, so the checks RLS used to make are
 * made here, in code, and these tests are what hold them:
 *
 *   - WHO: the verified server session, or (for a caller that has none, the
 *     scheduled pass) the owner the run's own server-side record names. Never
 *     the id a caller hands in: that id is a claim to be checked, not a value to
 *     be written.
 *   - WHOSE: only the run's owner, and another account gets the same answer as
 *     an id that never existed.
 *   - WHEN: only a run that has been claimed (ended). A result for a run still
 *     open is a row nobody earned.
 */
import type { RunResult } from '@/contract';
import {
  DiscardedRunSchema,
  InMemoryRunRepository,
  type DiscardedRun,
} from '@/data/run-repository';
import { getDataSource } from '@/data/source';
import type { LiveDetector } from '@/detector/resolve';
import { SESSION_HEADER } from '@/harness/server/http';
import { createLiveRunHost, type LiveRunPreflight, type LiveRunTicket } from '@/runs/live-run';
import { InMemoryLiveRunSessionStore } from '@/runs/live-run-store';
import {
  RUN_WRITE_NOT_FOUND_MESSAGE,
  RunWriteError,
  createRunWriter,
  type RunWriteIdentity,
} from '@/runs/run-writes';
import { InMemoryRunTokenStore } from '@/runs/run-token';

const OWNER = 'user-owner';
const OTHER = 'user-other';
const RUN = 'run-1';

async function resultFor(runId: string): Promise<RunResult> {
  const sample = await getDataSource().getRun('sample');
  if (!sample) throw new Error('sample run missing');
  return { ...sample, runId };
}

const marker = (runId: string): DiscardedRun => ({
  discarded: true,
  runId,
  category: 'ASI01',
  model: 'manual-client',
  steps: 3,
  toolCalls: 1,
  discardedAt: '2026-10-13T10:00:00.000Z',
});

/** A registry holding one run for OWNER, ended unless told otherwise. */
async function registry(options: { ended?: boolean; owner?: string } = {}) {
  const sessions = new InMemoryLiveRunSessionStore();
  await sessions.create({
    runId: RUN,
    userId: options.owner ?? OWNER,
    category: 'ASI01',
    kind: 'malicious',
    model: null,
    client: null,
    target: '/api/mcp',
    startedAt: '2026-10-13T09:00:00.000Z',
    expiresAt: '2026-10-14T09:00:00.000Z',
    events: [],
  });
  if (options.ended !== false) await sessions.finish(RUN, new Date('2026-10-13T09:30:00.000Z'));
  return sessions;
}

const session = (id: string | null): RunWriteIdentity => ({
  from: 'session',
  userId: async () => id,
});

async function refusal(work: Promise<unknown>): Promise<RunWriteError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof RunWriteError) return error;
    throw error;
  }
  throw new Error('expected the write to be refused, and it went through');
}

describe('run writes: who the row is written for', () => {
  it('writes the result under the verified session account', async () => {
    const store = new InMemoryRunRepository();
    const writer = createRunWriter({
      store,
      records: await registry(),
      identity: session(OWNER),
    });

    const stored = await writer.saveRun(OWNER, await resultFor(RUN));

    expect(stored.userId).toBe(OWNER);
    expect((await store.listRuns(OWNER)).map((row) => row.id)).toEqual([stored.id]);
  });

  it('ignores a forged account id: the caller names the owner, the session is somebody else', async () => {
    const store = new InMemoryRunRepository();
    const writer = createRunWriter({
      store,
      records: await registry(),
      identity: session(OTHER),
    });

    const error = await refusal(writer.saveRun(OWNER, await resultFor(RUN)));

    expect(error.code).toBe('RUN_NOT_FOUND');
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(0);
    expect(await store.countRunsSince(OTHER, new Date(0))).toBe(0);
  });

  it('ignores a forged account id: the session owns the run, the caller names somebody else', async () => {
    const store = new InMemoryRunRepository();
    const writer = createRunWriter({
      store,
      records: await registry(),
      identity: session(OWNER),
    });

    const error = await refusal(writer.saveRun(OTHER, await resultFor(RUN)));

    expect(error.code).toBe('RUN_NOT_FOUND');
    expect(await store.countRunsSince(OTHER, new Date(0))).toBe(0);
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(0);
  });

  it('writes nothing when nobody is signed in', async () => {
    const store = new InMemoryRunRepository();
    const writer = createRunWriter({ store, records: await registry(), identity: session(null) });

    const error = await refusal(writer.saveRun(OWNER, await resultFor(RUN)));

    expect(error.code).toBe('NOT_SIGNED_IN');
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(0);
  });

  it('asks the session before it reads anything about the run', async () => {
    const find = vi.fn();
    const writer = createRunWriter({
      store: new InMemoryRunRepository(),
      records: { find },
      identity: session(null),
    });

    await refusal(writer.saveRun(OWNER, await resultFor(RUN)));

    expect(find).not.toHaveBeenCalled();
  });
});

describe('run writes: whose run it is', () => {
  it('gives another account the same answer as a run that never existed', async () => {
    const store = new InMemoryRunRepository();
    const records = await registry();
    const stranger = createRunWriter({ store, records, identity: session(OTHER) });

    const theirs = await refusal(stranger.saveRun(OTHER, await resultFor(RUN)));
    const missing = await refusal(stranger.saveRun(OTHER, await resultFor('run-never-existed')));

    expect(theirs.code).toBe('RUN_NOT_FOUND');
    expect(missing.code).toBe('RUN_NOT_FOUND');
    expect(theirs.message).toBe(RUN_WRITE_NOT_FOUND_MESSAGE);
    expect(missing.message).toBe(theirs.message);
    expect(await store.countRunsSince(OTHER, new Date(0))).toBe(0);
  });

  it('refuses a result for a run that is still open', async () => {
    const store = new InMemoryRunRepository();
    const writer = createRunWriter({
      store,
      records: await registry({ ended: false }),
      identity: session(OWNER),
    });

    const error = await refusal(writer.saveRun(OWNER, await resultFor(RUN)));

    expect(error.code).toBe('RUN_NOT_ENDED');
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(0);
  });

  it('never puts an account id or a run id in the refusal', async () => {
    const writer = createRunWriter({
      store: new InMemoryRunRepository(),
      records: await registry(),
      identity: session(OTHER),
    });

    const error = await refusal(writer.saveRun(OWNER, await resultFor(RUN)));

    expect(error.message).not.toContain(OWNER);
    expect(error.message).not.toContain(OTHER);
    expect(error.message).not.toContain(RUN);
  });
});

describe('run writes: a caller with no session (the scheduled pass)', () => {
  it('writes under the owner the run record names, and asks no session', async () => {
    const store = new InMemoryRunRepository();
    const writer = createRunWriter({
      store,
      records: await registry(),
      identity: { from: 'run-record' },
    });

    const stored = await writer.saveRun(OWNER, await resultFor(RUN));

    expect(stored.userId).toBe(OWNER);
  });

  it('refuses an owner the run record does not name', async () => {
    const store = new InMemoryRunRepository();
    const writer = createRunWriter({
      store,
      records: await registry(),
      identity: { from: 'run-record' },
    });

    const error = await refusal(writer.saveRun(OTHER, await resultFor(RUN)));

    expect(error.code).toBe('RUN_NOT_FOUND');
    expect(await store.countRunsSince(OTHER, new Date(0))).toBe(0);
  });

  it('refuses a run no record has ever heard of', async () => {
    const writer = createRunWriter({
      store: new InMemoryRunRepository(),
      records: new InMemoryLiveRunSessionStore(),
      identity: { from: 'run-record' },
    });

    expect((await refusal(writer.saveRun(OWNER, await resultFor(RUN)))).code).toBe('RUN_NOT_FOUND');
  });
});

describe('run writes: the discard marker (ADR-0013)', () => {
  it('stores the marker under the session account, with no verdict in it', async () => {
    const store = new InMemoryRunRepository();
    const writer = createRunWriter({ store, records: await registry(), identity: session(OWNER) });

    const stored = await writer.saveDiscardedRun(OWNER, marker(RUN));

    expect(stored.userId).toBe(OWNER);
    expect(DiscardedRunSchema.parse(stored.discarded)).toEqual(marker(RUN));
    expect(Object.keys(stored.discarded)).not.toContain('verdict');
    // Counted by the allowance, and never listed as a judged run.
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(1);
    expect(await store.listRuns(OWNER)).toEqual([]);
  });

  it('refuses a marker for another account’s run, like an id that never existed', async () => {
    const store = new InMemoryRunRepository();
    const writer = createRunWriter({ store, records: await registry(), identity: session(OTHER) });

    const error = await refusal(writer.saveDiscardedRun(OTHER, marker(RUN)));

    expect(error.code).toBe('RUN_NOT_FOUND');
    expect(await store.listDiscardedRuns(OTHER)).toEqual([]);
    expect(await store.listDiscardedRuns(OWNER)).toEqual([]);
  });

  it('refuses a marker that carries anything a marker may not carry', async () => {
    const store = new InMemoryRunRepository();
    const writer = createRunWriter({ store, records: await registry(), identity: session(OWNER) });
    const forged = { ...marker(RUN), verdict: { compromised: false } } as unknown as DiscardedRun;

    await expect(writer.saveDiscardedRun(OWNER, forged)).rejects.toThrow();
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(0);
  });

  it('refuses a marker for a run that is still open', async () => {
    const store = new InMemoryRunRepository();
    const writer = createRunWriter({
      store,
      records: await registry({ ended: false }),
      identity: session(OWNER),
    });

    expect((await refusal(writer.saveDiscardedRun(OWNER, marker(RUN)))).code).toBe('RUN_NOT_ENDED');
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(0);
  });
});

/**
 * THE PIPELINE OVER THE REAL WRITER.
 *
 * The gate is the pipeline's and is not moved or repeated by this module. What
 * is asserted here is the join: with the writer in the persistence seat, a
 * refused gate still writes nothing, at either end, and a discard still asks no
 * gate and no judge.
 */
describe('run writes: behind the gates, in the pipeline', () => {
  const detector: LiveDetector = async (trace) => ({
    runId: trace.runId,
    compromised: false,
    score: 0.05,
    severity: 'None',
    category: trace.category,
    rationale: 'The agent did not act on the injected instruction.',
  });

  function pipeline(options: { preflight: LiveRunPreflight; sessionUser?: string | null }) {
    const store = new InMemoryRunRepository();
    const sessions = new InMemoryLiveRunSessionStore();
    const saveRun = vi.spyOn(store, 'saveRun');
    const saveDiscardedRun = vi.spyOn(store, 'saveDiscardedRun');
    const judge = vi.fn(detector);
    const writer = createRunWriter({
      store,
      records: sessions,
      identity: session(options.sessionUser === undefined ? OWNER : options.sessionUser),
    });
    const host = createLiveRunHost({
      preflight: options.preflight,
      tokens: new InMemoryRunTokenStore(),
      sessions,
      repository: {
        saveRun: (userId, run) => writer.saveRun(userId, run),
        saveDiscardedRun: (userId, discarded) => writer.saveDiscardedRun(userId, discarded),
        findByRunId: (userId, runId) => store.findByRunId(userId, runId),
        findDiscardedByRunId: (userId, runId) => store.findDiscardedByRunId(userId, runId),
      },
      resolveDetector: () => judge,
      origin: 'https://mcproof.test',
    });
    return { host, store, sessions, saveRun, saveDiscardedRun, judge };
  }

  async function callTool(
    host: ReturnType<typeof pipeline>['host'],
    ticket: LiveRunTicket,
  ): Promise<void> {
    const send = async (payload: unknown, sessionId?: string): Promise<Response> => {
      const headers = new Headers({
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${ticket.token}`,
      });
      if (sessionId !== undefined) headers.set(SESSION_HEADER, sessionId);
      return host.handle(
        new Request(ticket.endpoint, { method: 'POST', headers, body: JSON.stringify(payload) }),
      );
    };
    const opened = await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'writer-test-agent' } },
    });
    const sessionId = opened.headers.get(SESSION_HEADER) ?? undefined;
    await send({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
    await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sessionId);
  }

  const refused = (code: 'ALLOWANCE_EXHAUSTED' | 'SPEND_CAP_REACHED'): LiveRunPreflight => {
    return async () => ({ allowed: false, refusal: { code, message: 'refused' } });
  };

  it.each(['ALLOWANCE_EXHAUSTED', 'SPEND_CAP_REACHED'] as const)(
    'a start refused with %s writes nothing: no run record, no token, no row',
    async (code) => {
      const { host, store, sessions, saveRun } = pipeline({ preflight: refused(code) });

      const decision = await host.start({ userId: OWNER, category: 'ASI01' });

      expect(decision.ok).toBe(false);
      expect(await sessions.findStale(new Date('2999-01-01T00:00:00.000Z'))).toEqual([]);
      expect(saveRun).not.toHaveBeenCalled();
      expect(await store.countRunsSince(OWNER, new Date(0))).toBe(0);
    },
  );

  it.each(['ALLOWANCE_EXHAUSTED', 'SPEND_CAP_REACHED'] as const)(
    'a finish refused with %s at the judge gate writes nothing and asks no judge',
    async (code) => {
      let open = true;
      const gate: LiveRunPreflight = async (input) =>
        open ? { allowed: true } : refused(code)(input);
      const { host, store, saveRun, judge } = pipeline({ preflight: gate });
      const started = await host.start({ userId: OWNER, category: 'ASI01' });
      if (!started.ok) throw started.error;
      await callTool(host, started.value);
      open = false;

      const decision = await host.finish({ runId: started.value.runId, userId: OWNER });

      expect(decision.ok).toBe(false);
      expect(judge).not.toHaveBeenCalled();
      expect(saveRun).not.toHaveBeenCalled();
      expect(await store.countRunsSince(OWNER, new Date(0))).toBe(0);
    },
  );

  it('a gate that cannot be read writes nothing either', async () => {
    const { host, store, saveRun } = pipeline({
      preflight: async () => {
        throw new Error('the run store is unreachable');
      },
    });

    const decision = await host.start({ userId: OWNER, category: 'ASI01' });

    expect(decision.ok).toBe(false);
    expect(saveRun).not.toHaveBeenCalled();
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(0);
  });

  it('passes the gate before the judge, and the judge before the write', async () => {
    const order: string[] = [];
    const { host, saveRun, judge } = pipeline({
      preflight: async () => {
        order.push('gate');
        return { allowed: true };
      },
    });
    judge.mockImplementation(async (trace, goal) => {
      order.push('judge');
      return detector(trace, goal);
    });
    saveRun.mockImplementation(async (userId, run) => {
      order.push('write');
      return { id: 'row-1', userId, createdAt: '2026-10-13T10:00:00.000Z', run };
    });
    const started = await host.start({ userId: OWNER, category: 'ASI01' });
    if (!started.ok) throw started.error;
    await callTool(host, started.value);

    const decision = await host.finish({ runId: started.value.runId, userId: OWNER });

    expect(decision.ok).toBe(true);
    expect(order).toEqual(['gate', 'gate', 'judge', 'write']);
  });

  it('writes the judged result under the session account', async () => {
    const { host, store } = pipeline({ preflight: async () => ({ allowed: true }) });
    const started = await host.start({ userId: OWNER, category: 'ASI01' });
    if (!started.ok) throw started.error;
    await callTool(host, started.value);

    const decision = await host.finish({ runId: started.value.runId, userId: OWNER });

    expect(decision.ok).toBe(true);
    const rows = await store.listRuns(OWNER);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.run.runId).toBe(started.value.runId);
  });

  it('another account finishing the run is told it was not found, and nothing is written', async () => {
    const { host, store, saveRun, judge } = pipeline({
      preflight: async () => ({ allowed: true }),
    });
    const started = await host.start({ userId: OWNER, category: 'ASI01' });
    if (!started.ok) throw started.error;

    const decision = await host.finish({ runId: started.value.runId, userId: OTHER });

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.error.code).toBe('RUN_NOT_FOUND');
    expect(judge).not.toHaveBeenCalled();
    expect(saveRun).not.toHaveBeenCalled();
    expect(await store.countRunsSince(OTHER, new Date(0))).toBe(0);
  });

  it('a discard asks no gate and no judge, stores the marker, and still counts', async () => {
    const gate = vi.fn<LiveRunPreflight>(async () => ({ allowed: true }));
    const { host, store, saveRun, saveDiscardedRun, judge } = pipeline({ preflight: gate });
    const started = await host.start({ userId: OWNER, category: 'ASI01' });
    if (!started.ok) throw started.error;
    await callTool(host, started.value);
    gate.mockClear();

    const decision = await host.discard({ runId: started.value.runId, userId: OWNER });

    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.value.storedRunId).not.toBeNull();
    expect(gate).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
    expect(saveRun).not.toHaveBeenCalled();
    expect(saveDiscardedRun).toHaveBeenCalledTimes(1);
    // Still one of the account's runs, and not a judged one.
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(1);
    expect(await store.listRuns(OWNER)).toEqual([]);
  });

  it('a discarded run cannot afterwards be finished, so it is never judged or written twice', async () => {
    const { host, store, saveRun, judge } = pipeline({
      preflight: async () => ({ allowed: true }),
    });
    const started = await host.start({ userId: OWNER, category: 'ASI01' });
    if (!started.ok) throw started.error;
    await host.discard({ runId: started.value.runId, userId: OWNER });

    const decision = await host.finish({ runId: started.value.runId, userId: OWNER });

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.error.code).toBe('RUN_DISCARDED');
    expect(judge).not.toHaveBeenCalled();
    expect(saveRun).not.toHaveBeenCalled();
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(1);
  });

  it('another account discarding the run is told it was not found, and no marker is written', async () => {
    const { host, store, saveDiscardedRun } = pipeline({
      preflight: async () => ({ allowed: true }),
    });
    const started = await host.start({ userId: OWNER, category: 'ASI01' });
    if (!started.ok) throw started.error;

    const decision = await host.discard({ runId: started.value.runId, userId: OTHER });

    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.error.code).toBe('RUN_NOT_FOUND');
    expect(saveDiscardedRun).not.toHaveBeenCalled();
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(0);
  });
});
