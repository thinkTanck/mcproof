/**
 * DISCARDING A RUN: the user-initiated end that is never judged.
 *
 * A person who connects a manual client and presses a tool by hand has not run
 * a test, and until now the only ways out were to have it judged or to walk
 * away and let the scheduled pass judge it for them. Each rule of the approved
 * design is pinned here on its own:
 *
 *   - it ends the run and revokes the token, once;
 *   - it makes no judge call and asks no gate;
 *   - it stores a row marked discarded, with no verdict anywhere in it;
 *   - the allowance still counts that row, the spend meter does not;
 *   - the scheduled pass skips it;
 *   - it cannot afterwards be finished, judged, discarded again or reconnected;
 *   - another account gets the answer an unknown run gets.
 */
import { InMemoryRunRepository } from '@/data/run-repository';
import type { LiveDetector } from '@/detector/resolve';
import { SESSION_HEADER } from '@/harness/server/http';
import { createLogger } from '@/lib/logger';
import { checkLiveRunAllowance } from '@/runs/allowance';
import { RUN_DISCARDED_SENTENCE } from '@/runs/discard-copy';
import {
  createLiveRunHost,
  type LiveRunHost,
  type LiveRunHostDeps,
  type LiveRunPreflight,
} from '@/runs/live-run';
import { InMemoryLiveRunSessionStore } from '@/runs/live-run-store';
import { reapAbandonedRuns } from '@/runs/reaper';
import { InMemoryRunTokenStore } from '@/runs/run-token';
import type { Trace, Verdict } from '@/contract';

const USER = 'user-1';
const ORIGIN = 'https://example.test';

const STARTED = new Date('2026-10-09T10:00:00.000Z');
/** Past the token TTL and the session grace: the scheduled pass would act now. */
const AFTER = new Date('2026-10-12T10:00:00.000Z');

interface Bench {
  host: LiveRunHost;
  tokens: InMemoryRunTokenStore;
  sessions: InMemoryLiveRunSessionStore;
  repository: InMemoryRunRepository;
  judged: () => number;
  gated: () => number;
  ended: () => number;
  lines: string[];
  clock: { at: Date };
}

function bench(overrides: Partial<LiveRunHostDeps> = {}): Bench {
  const tokens = new InMemoryRunTokenStore();
  const sessions = new InMemoryLiveRunSessionStore();
  const repository = new InMemoryRunRepository();
  const lines: string[] = [];
  const clock = { at: STARTED };
  let judged = 0;
  let gated = 0;
  let ended = 0;
  const endRun = tokens.endRun.bind(tokens);
  tokens.endRun = async (runId, at) => {
    ended += 1;
    return endRun(runId, at);
  };
  const detector: LiveDetector = async (trace: Trace): Promise<Verdict> => {
    judged += 1;
    return {
      runId: trace.runId,
      compromised: false,
      score: 0,
      severity: 'None',
      category: trace.category,
      rationale: 'The agent did not act on the injected content.',
    };
  };
  const preflight: LiveRunPreflight = async () => {
    gated += 1;
    return { allowed: true };
  };
  const host = createLiveRunHost({
    preflight,
    tokens,
    sessions,
    repository,
    resolveDetector: () => detector,
    origin: ORIGIN,
    logger: createLogger({ sink: (line) => lines.push(line) }),
    now: () => clock.at,
    sleep: async () => {},
    ...overrides,
  });
  return {
    host,
    tokens,
    sessions,
    repository,
    judged: () => judged,
    gated: () => gated,
    ended: () => ended,
    lines,
    clock,
  };
}

async function startRun(host: LiveRunHost, userId: string = USER) {
  const decision = await host.start({ userId, category: 'ASI01', kind: 'malicious' });
  if (!decision.ok) throw new Error(`start refused: ${decision.error.code}`);
  return decision.value;
}

function post(
  host: LiveRunHost,
  endpoint: string,
  payload: unknown,
  opts: { token?: string; sessionId?: string } = {},
): Promise<Response> {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  });
  if (opts.token !== undefined) headers.set('authorization', `Bearer ${opts.token}`);
  if (opts.sessionId !== undefined) headers.set(SESSION_HEADER, opts.sessionId);
  return host.handle(
    new Request(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) }),
  );
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', clientInfo: { name: 'manual-client', version: '1' } },
};

/** One tool pressed by hand, the way a manual client does it. */
async function pressOneTool(host: LiveRunHost, ticket: { endpoint: string; token: string }) {
  const opened = await post(host, ticket.endpoint, initialize, { token: ticket.token });
  const sessionId = opened.headers.get(SESSION_HEADER)!;
  const common = { token: ticket.token, sessionId };
  await post(
    host,
    ticket.endpoint,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    common,
  );
  await post(
    host,
    ticket.endpoint,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'read_email', arguments: { mailbox: 'inbox' } },
    },
    common,
  );
}

describe('discard: ends the run and revokes its token', () => {
  it('ends a connected run: the endpoint stops answering and the run reads finished', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);

    const decision = await b.host.discard({ runId: ticket.runId, userId: USER });
    const after = await post(b.host, ticket.endpoint, initialize, { token: ticket.token });
    const status = await b.host.getStatus({ runId: ticket.runId, userId: USER });

    expect(decision.ok).toBe(true);
    expect(after.status).toBe(401);
    expect(status.ok && status.value.finishedAt).toBe(STARTED.toISOString());
    expect((await b.sessions.find(ticket.runId))?.finishedAt).toBe(STARTED.toISOString());
  });

  it('ends a run no agent ever reached, the same way', async () => {
    const b = bench();
    const ticket = await startRun(b.host);

    const decision = await b.host.discard({ runId: ticket.runId, userId: USER });
    const after = await post(b.host, ticket.endpoint, initialize, { token: ticket.token });

    expect(decision.ok).toBe(true);
    expect(after.status).toBe(401);
  });

  it('revokes the token exactly once', async () => {
    const b = bench();
    const ticket = await startRun(b.host);

    await b.host.discard({ runId: ticket.runId, userId: USER });
    await b.host.discard({ runId: ticket.runId, userId: USER });
    await b.host.finish({ runId: ticket.runId, userId: USER });

    expect(b.ended()).toBe(1);
  });

  it('logs the discard without a token or a payload', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await b.host.discard({ runId: ticket.runId, userId: USER });

    const line = b.lines.find((l) => l.includes('live run discarded'));
    expect(line).toBeDefined();
    expect(b.lines.join('\n')).not.toContain(ticket.token);
  });
});

describe('discard: no judge call and no gate', () => {
  it('never asks the judge', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);

    await b.host.discard({ runId: ticket.runId, userId: USER });

    expect(b.judged()).toBe(0);
  });

  it('never resolves the detector at all, so it works while live detection is off', async () => {
    let resolved = 0;
    let available = true;
    const b = bench({
      resolveDetector: () => {
        resolved += 1;
        return available ? async () => Promise.reject(new Error('must not be asked')) : null;
      },
    });
    const ticket = await startRun(b.host);
    const afterStart = resolved;
    available = false;

    const decision = await b.host.discard({ runId: ticket.runId, userId: USER });

    expect(decision.ok).toBe(true);
    expect(resolved).toBe(afterStart);
  });

  it('never asks the gate again: one preflight call, and it belongs to start', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    expect(b.gated()).toBe(1);

    await b.host.discard({ runId: ticket.runId, userId: USER });

    expect(b.gated()).toBe(1);
  });

  it('still discards when the gate would refuse or cannot be read', async () => {
    let mode: 'grant' | 'refuse' | 'throw' = 'grant';
    const b = bench({
      preflight: async () => {
        if (mode === 'throw') throw new Error('store unreachable');
        if (mode === 'refuse') {
          return {
            allowed: false,
            refusal: { code: 'ALLOWANCE_EXHAUSTED', message: 'out of runs' },
          };
        }
        return { allowed: true };
      },
    });
    const first = await startRun(b.host);
    const second = await startRun(b.host);

    mode = 'refuse';
    const refused = await b.host.discard({ runId: first.runId, userId: USER });
    mode = 'throw';
    const thrown = await b.host.discard({ runId: second.runId, userId: USER });

    expect(refused.ok).toBe(true);
    expect(thrown.ok).toBe(true);
  });
});

describe('discard: stores a row marked discarded, with no verdict', () => {
  it('stores one discarded row for the owner, addressed by the hosted run id', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);

    const decision = await b.host.discard({ runId: ticket.runId, userId: USER });
    const rows = await b.repository.listDiscardedRuns(USER);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.discarded).toMatchObject({
      discarded: true,
      runId: ticket.runId,
      category: 'ASI01',
      toolCalls: 1,
      discardedAt: STARTED.toISOString(),
    });
    expect(decision.ok && decision.value.storedRunId).toBe(rows[0]!.id);
    expect((await b.repository.findDiscardedByRunId(USER, ticket.runId))?.id).toBe(rows[0]!.id);
  });

  it('carries no verdict, no compromised ruling and no trace in the stored row', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);
    await b.host.discard({ runId: ticket.runId, userId: USER });

    const [row] = await b.repository.listDiscardedRuns(USER);
    const text = JSON.stringify(row);

    expect(text).not.toContain('verdict');
    expect(text).not.toContain('compromised');
    expect(text).not.toContain('rationale');
    expect(text).not.toContain('"steps":[');
  });

  it('is not a judged run: the judged reads do not return it', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await b.host.discard({ runId: ticket.runId, userId: USER });
    const [row] = await b.repository.listDiscardedRuns(USER);

    expect(await b.repository.listRuns(USER)).toHaveLength(0);
    expect(await b.repository.getRun(USER, row!.id)).toBeNull();
    expect(await b.repository.findByRunId(USER, ticket.runId)).toBeNull();
  });

  it('still ends the run, unjudged, when the row cannot be saved', async () => {
    const b = bench();
    b.repository.saveDiscardedRun = async () => {
      throw new Error('insert failed: connection reset by db.internal:5432');
    };
    const ticket = await startRun(b.host);

    const decision = await b.host.discard({ runId: ticket.runId, userId: USER });
    const after = await post(b.host, ticket.endpoint, initialize, { token: ticket.token });
    const finish = await b.host.finish({ runId: ticket.runId, userId: USER });

    expect(decision.ok).toBe(true);
    expect(decision.ok && decision.value.storedRunId).toBeNull();
    expect(after.status).toBe(401);
    expect(finish.ok).toBe(false);
    expect(b.judged()).toBe(0);
  });
});

describe('discard: the allowance is not returned, and no spend is counted', () => {
  it('counts a discarded run against the lifetime allowance exactly like a judged one', async () => {
    const b = bench();
    const env = { LIVE_RUN_ALLOWANCE: '2' };
    const first = await startRun(b.host);
    const second = await startRun(b.host);
    await pressOneTool(b.host, second);

    await b.host.discard({ runId: first.runId, userId: USER });
    const one = await checkLiveRunAllowance({ repository: b.repository, userId: USER, env });
    await b.host.finish({ runId: second.runId, userId: USER });
    const two = await checkLiveRunAllowance({ repository: b.repository, userId: USER, env });

    expect(one).toMatchObject({ allowed: true, used: 1, remaining: 1 });
    expect(two).toMatchObject({ allowed: false, used: 2, remaining: 0 });
  });

  it('refuses the next run once discards alone have used the allowance up', async () => {
    const b = bench();
    const env = { LIVE_RUN_ALLOWANCE: '1' };
    const ticket = await startRun(b.host);
    await b.host.discard({ runId: ticket.runId, userId: USER });

    const decision = await checkLiveRunAllowance({ repository: b.repository, userId: USER, env });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.error.code).toBe('ALLOWANCE_EXHAUSTED');
  });

  it('does not count another account discards against this one', async () => {
    const b = bench();
    const theirs = await startRun(b.host, 'user-2');
    await b.host.discard({ runId: theirs.runId, userId: 'user-2' });

    expect(await b.repository.countRunsSince(USER, new Date(0))).toBe(0);
    expect(await b.repository.countRunsSince('user-2', new Date(0))).toBe(1);
  });
});

describe('discard: the scheduled pass skips a discarded run', () => {
  it('does not list a discarded run as stale, however old it is', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);
    await b.host.discard({ runId: ticket.runId, userId: USER });

    expect(await b.sessions.findStale(AFTER)).toHaveLength(0);
  });

  it('neither judges nor closes it, and stores nothing further', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);
    await b.host.discard({ runId: ticket.runId, userId: USER });

    b.clock.at = AFTER;
    const report = await reapAbandonedRuns({
      sessions: b.sessions,
      host: b.host,
      now: () => AFTER,
    });

    expect(report).toMatchObject({ examined: 0, judged: 0, closed: 0, failed: 0 });
    expect(b.judged()).toBe(0);
    expect(await b.repository.listRuns(USER)).toHaveLength(0);
    expect(await b.repository.listDiscardedRuns(USER)).toHaveLength(1);
  });

  it('counts it as contended when the pass listed it just before it was discarded', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);

    // The pass has already read its list when the owner discards the run.
    const listed = await b.sessions.findStale(AFTER);
    expect(listed).toHaveLength(1);
    await b.host.discard({ runId: ticket.runId, userId: USER });
    const report = await reapAbandonedRuns({
      sessions: {
        findStale: async () => listed,
        find: (runId) => b.sessions.find(runId),
        sweepExpired: async () => 0,
      },
      host: b.host,
      now: () => AFTER,
    });

    expect(report).toMatchObject({ examined: 1, judged: 0, closed: 0, contended: 1 });
    expect(b.judged()).toBe(0);
  });

  it('counts it as contended, not refused, when the discard lands after the pass re-read the row', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);
    const listed = await b.sessions.findStale(AFTER);
    const stillOpen = await b.sessions.find(ticket.runId);
    await b.host.discard({ runId: ticket.runId, userId: USER });

    // The pass holds a copy of the row from before the discard, so it asks.
    const report = await reapAbandonedRuns({
      sessions: {
        findStale: async () => listed,
        find: async () => stillOpen,
        sweepExpired: async () => 0,
      },
      host: b.host,
      now: () => AFTER,
    });

    expect(report).toMatchObject({ judged: 0, closed: 0, contended: 1, refused: 0, failed: 0 });
    expect(b.judged()).toBe(0);
    expect(await b.repository.listRuns(USER)).toHaveLength(0);
  });

  it('loses to the pass when the pass claims the run first, and then stores no marker', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);

    b.clock.at = AFTER;
    const report = await reapAbandonedRuns({
      sessions: {
        findStale: (now, limit) => b.sessions.findStale(now, limit),
        find: (id) => b.sessions.find(id),
        sweepExpired: async () => 0,
      },
      host: b.host,
      now: () => AFTER,
    });
    const late = await b.host.discard({ runId: ticket.runId, userId: USER });

    expect(report.judged).toBe(1);
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.error.code).toBe('RUN_ALREADY_FINISHED');
    expect(await b.repository.listDiscardedRuns(USER)).toHaveLength(0);
    expect(await b.repository.listRuns(USER)).toHaveLength(1);
  });
});

describe('discard: a discarded run cannot be finished, judged, resumed or discarded again', () => {
  it('refuses a later finish with a typed RUN_DISCARDED, and the judge is never asked', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);
    await b.host.discard({ runId: ticket.runId, userId: USER });

    const finish = await b.host.finish({ runId: ticket.runId, userId: USER });

    expect(finish.ok).toBe(false);
    if (finish.ok) return;
    expect(finish.error.code).toBe('RUN_DISCARDED');
    expect(finish.error.message).toBe(RUN_DISCARDED_SENTENCE);
    expect(b.judged()).toBe(0);
    expect(await b.repository.listRuns(USER)).toHaveLength(0);
  });

  it('refuses a second discard the same way and stores no second row', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await b.host.discard({ runId: ticket.runId, userId: USER });

    const again = await b.host.discard({ runId: ticket.runId, userId: USER });

    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe('RUN_DISCARDED');
    expect(await b.repository.listDiscardedRuns(USER)).toHaveLength(1);
  });

  it('refuses to close it as abandoned', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await b.host.discard({ runId: ticket.runId, userId: USER });

    const abandon = await b.host.abandon({ runId: ticket.runId, userId: USER });

    expect(abandon.ok).toBe(false);
  });

  it('refuses to discard a run that was already finished and judged', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);
    await b.host.finish({ runId: ticket.runId, userId: USER });

    const late = await b.host.discard({ runId: ticket.runId, userId: USER });

    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.error.code).toBe('RUN_ALREADY_FINISHED');
    expect(await b.repository.listDiscardedRuns(USER)).toHaveLength(0);
    expect(await b.repository.listRuns(USER)).toHaveLength(1);
    expect(b.ended()).toBe(1);
  });

  it('lets exactly one of a racing discard and finish win, and never both', async () => {
    for (const order of ['discard-first', 'finish-first'] as const) {
      const b = bench();
      const ticket = await startRun(b.host);
      await pressOneTool(b.host, ticket);
      const ref = { runId: ticket.runId, userId: USER };

      const [first, second] = await Promise.all(
        order === 'discard-first'
          ? [b.host.discard(ref), b.host.finish(ref)]
          : [b.host.finish(ref), b.host.discard(ref)],
      );

      expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
      const judgedRows = (await b.repository.listRuns(USER)).length;
      const discardedRows = (await b.repository.listDiscardedRuns(USER)).length;
      // One row in total: the run is either a result or a discard, never both.
      expect(judgedRows + discardedRows).toBe(1);
      expect(b.judged()).toBe(judgedRows);
      expect(b.ended()).toBe(1);
    }
  });

  it('grants one of two racing discards from two tabs', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    const ref = { runId: ticket.runId, userId: USER };

    const answers = await Promise.all([b.host.discard(ref), b.host.discard(ref)]);

    expect(answers.filter((a) => a.ok)).toHaveLength(1);
    expect(await b.repository.listDiscardedRuns(USER)).toHaveLength(1);
    expect(b.ended()).toBe(1);
  });

  it('grants one discard across two instances sharing the durable stores', async () => {
    const a = bench();
    const other = createLiveRunHost({
      preflight: async () => ({ allowed: true }),
      tokens: a.tokens,
      sessions: a.sessions,
      repository: a.repository,
      resolveDetector: () => async () => Promise.reject(new Error('must not be asked')),
      origin: ORIGIN,
      now: () => STARTED,
    });
    const ticket = await startRun(a.host);
    const ref = { runId: ticket.runId, userId: USER };

    const here = await a.host.discard(ref);
    const there = await other.finish(ref);

    expect(here.ok).toBe(true);
    expect(there.ok).toBe(false);
    if (there.ok) return;
    expect(there.error.code).toBe('RUN_DISCARDED');
  });

  it('reads back as discarded on the status and reattach reads, with no saved result', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);
    const open = await b.host.getStatus({ runId: ticket.runId, userId: USER });
    await b.host.discard({ runId: ticket.runId, userId: USER });

    const status = await b.host.getStatus({ runId: ticket.runId, userId: USER });
    const reattach = await b.host.getReattach({ runId: ticket.runId, userId: USER });

    expect(open.ok && open.value.discarded).toBeFalsy();
    expect(status.ok && status.value.discarded).toBe(true);
    expect(reattach.ok && reattach.value.discarded).toBe(true);
    expect(reattach.ok && reattach.value.storedRunId).toBeNull();
    expect(JSON.stringify(reattach)).not.toContain(ticket.token);
  });

  it('does not call a judged run discarded', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);
    await b.host.finish({ runId: ticket.runId, userId: USER });

    const status = await b.host.getStatus({ runId: ticket.runId, userId: USER });
    const reattach = await b.host.getReattach({ runId: ticket.runId, userId: USER });

    expect(status.ok && status.value.discarded).toBeFalsy();
    expect(reattach.ok && reattach.value.discarded).toBeFalsy();
    expect(reattach.ok && reattach.value.storedRunId).not.toBeNull();
  });
});

describe('discard: ownership is checked on the server', () => {
  it('answers another account exactly as it answers a run that never existed', async () => {
    const b = bench();
    const ticket = await startRun(b.host);

    const unknown = await b.host.discard({ runId: 'no-such-run', userId: USER });
    const other = await b.host.discard({ runId: ticket.runId, userId: 'user-2' });

    expect(unknown.ok).toBe(false);
    expect(other.ok).toBe(false);
    if (unknown.ok || other.ok) return;
    expect(other.error.code).toBe('RUN_NOT_FOUND');
    expect(other.error.code).toBe(unknown.error.code);
    expect(other.error.message).toBe(unknown.error.message);
  });

  it('leaves the run open, its token alive and nothing stored when a stranger tries', async () => {
    const b = bench();
    const ticket = await startRun(b.host);

    await b.host.discard({ runId: ticket.runId, userId: 'user-2' });
    const still = await post(b.host, ticket.endpoint, initialize, { token: ticket.token });

    expect(still.status).toBe(200);
    expect(b.ended()).toBe(0);
    expect((await b.sessions.find(ticket.runId))?.finishedAt).toBeNull();
    expect(await b.repository.listDiscardedRuns('user-2')).toHaveLength(0);
    expect(await b.repository.listDiscardedRuns(USER)).toHaveLength(0);
  });

  it('gives another account the unknown-run answer for a run that IS discarded', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await b.host.discard({ runId: ticket.runId, userId: USER });
    const [row] = await b.repository.listDiscardedRuns(USER);

    const status = await b.host.getStatus({ runId: ticket.runId, userId: 'user-2' });
    const finish = await b.host.finish({ runId: ticket.runId, userId: 'user-2' });
    const again = await b.host.discard({ runId: ticket.runId, userId: 'user-2' });

    for (const answer of [status, finish, again]) {
      expect(answer.ok).toBe(false);
      if (answer.ok) continue;
      expect(answer.error.code).toBe('RUN_NOT_FOUND');
    }
    expect(await b.repository.getDiscardedRun('user-2', row!.id)).toBeNull();
    expect(await b.repository.findDiscardedByRunId('user-2', ticket.runId)).toBeNull();
  });
});

describe('discard: what a missing or unreadable marker can and cannot do', () => {
  it('never reopens or judges a discarded run when the marker cannot be read', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await pressOneTool(b.host, ticket);
    await b.host.discard({ runId: ticket.runId, userId: USER });
    b.repository.findDiscardedByRunId = async () => {
      throw new Error('select failed');
    };

    const status = await b.host.getStatus({ runId: ticket.runId, userId: USER });
    const finish = await b.host.finish({ runId: ticket.runId, userId: USER });
    const after = await post(b.host, ticket.endpoint, initialize, { token: ticket.token });

    // The reason is unknown, so it is not claimed; the run is still over.
    expect(status.ok && status.value.finishedAt).not.toBeNull();
    expect(status.ok && status.value.discarded).toBeFalsy();
    expect(finish.ok).toBe(false);
    if (finish.ok) return;
    expect(finish.error.code).toBe('RUN_ALREADY_FINISHED');
    expect(after.status).toBe(401);
    expect(b.judged()).toBe(0);
  });

  it('still ends the run unjudged on a host wired with no marker store at all', async () => {
    const b = bench();
    const saveRun = b.repository.saveRun.bind(b.repository);
    const bare = createLiveRunHost({
      preflight: async () => ({ allowed: true }),
      tokens: b.tokens,
      sessions: b.sessions,
      repository: { saveRun },
      resolveDetector: () => async () => Promise.reject(new Error('must not be asked')),
      origin: ORIGIN,
      now: () => STARTED,
    });
    const ticket = await startRun(bare);

    const decision = await bare.discard({ runId: ticket.runId, userId: USER });
    const status = await bare.getStatus({ runId: ticket.runId, userId: USER });
    const finish = await bare.finish({ runId: ticket.runId, userId: USER });

    expect(decision.ok && decision.value.storedRunId).toBeNull();
    expect(status.ok && status.value.finishedAt).not.toBeNull();
    expect(finish.ok).toBe(false);
    expect(await b.repository.listRuns(USER)).toHaveLength(0);
  });
});
