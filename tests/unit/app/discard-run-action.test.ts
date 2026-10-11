/**
 * THE DISCARD ACTION: owner-scoped on the server, and never a judge call.
 *
 * The account is read from the session and is never a parameter, so the only
 * way to discard a run is to be signed in as the account that issued it.
 */
import { InMemoryRunRepository } from '@/data/run-repository';
import { getUser } from '@/lib/auth/user';
import { RUN_DISCARDED_SENTENCE } from '@/runs/discard-copy';
import { createLiveRunHost, type LiveRunHost } from '@/runs/live-run';
import { InMemoryLiveRunSessionStore } from '@/runs/live-run-store';
import { InMemoryRunTokenStore } from '@/runs/run-token';
import { liveRunDeps, resetLiveRunRegistry } from '@/app/api/mcp/host';
import {
  discardLiveRun,
  finishLiveRun,
  getLiveRunReattach,
  getLiveRunStatus,
  startLiveRun,
} from '@/app/actions/live-run';
import { NOT_SIGNED_IN_MESSAGE, RUN_NOT_FOUND_MESSAGE } from '@/app/actions/live-run-contract';

const USER = 'user-actions';

let host: LiveRunHost;
let repository: InMemoryRunRepository;
let judged = 0;

vi.mock('@/lib/auth/user', () => ({ getUser: vi.fn() }));
vi.mock('@/app/api/mcp/host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/mcp/host')>();
  return { ...actual, getLiveRunHost: () => host };
});

function signedIn(id: string | null = USER): void {
  vi.mocked(getUser).mockResolvedValue((id === null ? null : { id }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLiveRunRegistry();
  signedIn();
  judged = 0;
  repository = new InMemoryRunRepository();
  host = createLiveRunHost({
    preflight: async () => ({ allowed: true }),
    tokens: new InMemoryRunTokenStore(),
    sessions: new InMemoryLiveRunSessionStore(),
    repository,
    resolveDetector: () => async (trace) => {
      judged += 1;
      return {
        runId: trace.runId,
        compromised: false,
        score: 0,
        severity: 'None',
        category: trace.category,
        rationale: 'clean',
      };
    },
    origin: 'https://mcproof.test',
  });
});

async function start() {
  const answer = await startLiveRun({ category: 'ASI01' });
  if (!answer.ok) throw new Error(answer.code);
  return answer.value;
}

describe('discardLiveRun', () => {
  it('ends the run without a verdict and says how much had been recorded', async () => {
    const ticket = await start();

    const answer = await discardLiveRun({ runId: ticket.runId });

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.runId).toBe(ticket.runId);
    expect(Number.isInteger(answer.value.steps)).toBe(true);
    expect(JSON.stringify(answer)).not.toMatch(/compromised|verdict|severity/);
    expect(judged).toBe(0);
    expect(await repository.listDiscardedRuns(USER)).toHaveLength(1);
  });

  it('refuses a signed-out caller before anything is read', async () => {
    const ticket = await start();
    signedIn(null);

    const answer = await discardLiveRun({ runId: ticket.runId });

    expect(answer).toEqual({ ok: false, code: 'NOT_SIGNED_IN', message: NOT_SIGNED_IN_MESSAGE });
    signedIn();
    expect((await getLiveRunStatus({ runId: ticket.runId })).ok).toBe(true);
    expect(await repository.listDiscardedRuns(USER)).toHaveLength(0);
  });

  it('takes no account from the caller: a smuggled userId is an invalid request', async () => {
    const ticket = await start();

    const answer = await discardLiveRun({ runId: ticket.runId, userId: USER });

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.code).toBe('INVALID_REQUEST');
    expect(await repository.listDiscardedRuns(USER)).toHaveLength(0);
  });

  it('answers another account exactly as it answers an id that never existed', async () => {
    const ticket = await start();
    signedIn('someone-else');

    const theirs = await discardLiveRun({ runId: ticket.runId });
    const unknown = await discardLiveRun({ runId: 'no-such-run' });

    expect(theirs).toEqual(unknown);
    expect(theirs).toEqual({ ok: false, code: 'RUN_NOT_FOUND', message: RUN_NOT_FOUND_MESSAGE });
    signedIn();
    const status = await getLiveRunStatus({ runId: ticket.runId });
    expect(status.ok && status.value.phase).toBe('waiting');
  });

  it('answers another account the same way once the run IS discarded', async () => {
    const ticket = await start();
    await discardLiveRun({ runId: ticket.runId });
    signedIn('someone-else');

    for (const answer of [
      await getLiveRunStatus({ runId: ticket.runId }),
      await getLiveRunReattach({ runId: ticket.runId }),
      await finishLiveRun({ runId: ticket.runId }),
      await discardLiveRun({ runId: ticket.runId }),
    ]) {
      expect(answer).toEqual({ ok: false, code: 'RUN_NOT_FOUND', message: RUN_NOT_FOUND_MESSAGE });
    }
  });

  it('makes the status and the reattach read say the run was discarded', async () => {
    const ticket = await start();
    const before = await getLiveRunStatus({ runId: ticket.runId });
    await discardLiveRun({ runId: ticket.runId });

    const status = await getLiveRunStatus({ runId: ticket.runId });
    const reattach = await getLiveRunReattach({ runId: ticket.runId });

    expect(before.ok && before.value.discarded).toBeFalsy();
    expect(status.ok && status.value.phase).toBe('finished');
    expect(status.ok && status.value.discarded).toBe(true);
    expect(reattach.ok && reattach.value.discarded).toBe(true);
    expect(reattach.ok && reattach.value.storedRunId).toBeNull();
  });

  it('refuses to judge a discarded run, with the sentence the screens use', async () => {
    const ticket = await start();
    await discardLiveRun({ runId: ticket.runId });

    const finish = await finishLiveRun({ runId: ticket.runId });

    expect(finish).toEqual({ ok: false, code: 'RUN_DISCARDED', message: RUN_DISCARDED_SENTENCE });
    expect(judged).toBe(0);
  });
});

describe('the production wiring', () => {
  it('gives the pipeline the two repository calls a discard needs', () => {
    const { repository: wired } = liveRunDeps();

    expect(typeof wired.saveDiscardedRun).toBe('function');
    expect(typeof wired.findDiscardedByRunId).toBe('function');
  });
});
