/**
 * THE REAPER — what happens to a run whose owner closed the tab.
 *
 * `END RUN AND JUDGE` on `/connect` used to be the only way a run finished, so a
 * user who walked away left the run open until its token expired and then lost
 * the verdict for inference they had already paid for. These tests pin the job
 * that finishes it for them.
 *
 * The clock is injected everywhere. Nothing here sleeps.
 */
import { InMemoryRunRepository } from '@/data/run-repository';
import type { LiveDetector } from '@/detector/resolve';
import { SESSION_HEADER } from '@/harness/server/http';
import { createLogger } from '@/lib/logger';
import {
  createLiveRunHost,
  type LiveRunHost,
  type LiveRunPreflight,
  type LiveRunTicket,
} from '@/runs/live-run';
import { InMemoryLiveRunSessionStore, type LiveRunSessionStore } from '@/runs/live-run-store';
import { InMemoryRunTokenStore } from '@/runs/run-token';
import { reapAbandonedRuns, DEFAULT_REAP_LIMIT } from '@/runs/reaper';
import type { Trace, Verdict } from '@/contract';

const USER = 'user-1';
const ORIGIN = 'https://mcproof.test';

/** When the run starts, when its token dies, and when the grace after it does. */
const STARTED = new Date('2026-08-05T10:00:00.000Z');
/** Inside the run's own window: the token is alive and the user may still finish. */
const DURING = new Date('2026-08-05T10:30:00.000Z');
/** Past the token TTL and past the session grace. Nothing can change any more. */
const AFTER = new Date('2026-08-07T10:00:00.000Z');

const grant: LiveRunPreflight = async () => ({ allowed: true });

interface Bench {
  readonly host: LiveRunHost;
  readonly sessions: LiveRunSessionStore;
  readonly tokens: InMemoryRunTokenStore;
  readonly repository: InMemoryRunRepository;
  /** How many times the judge was actually asked. The operator pays per call. */
  judged: () => number;
  readonly lines: string[];
}

/** A judge that answers, and counts how often it was asked to. */
function countingDetector(counter: { calls: number }): LiveDetector {
  return async (trace: Trace): Promise<Verdict> => {
    counter.calls += 1;
    return {
      runId: trace.runId,
      compromised: false,
      score: 0,
      severity: 'None',
      category: trace.category,
      rationale: 'The agent did not act on the injected content.',
    };
  };
}

function bench(
  options: {
    preflight?: LiveRunPreflight;
    sessions?: LiveRunSessionStore;
    tokens?: InMemoryRunTokenStore;
    counter?: { calls: number };
    now?: () => Date;
  } = {},
): Bench {
  const counter = options.counter ?? { calls: 0 };
  const sessions = options.sessions ?? new InMemoryLiveRunSessionStore();
  const tokens = options.tokens ?? new InMemoryRunTokenStore();
  const repository = new InMemoryRunRepository();
  const lines: string[] = [];
  const host = createLiveRunHost({
    preflight: options.preflight ?? grant,
    tokens,
    sessions,
    repository,
    resolveDetector: () => countingDetector(counter),
    origin: ORIGIN,
    logger: createLogger({ sink: (line) => lines.push(line) }),
    now: options.now ?? (() => STARTED),
    sleep: async () => {},
  });
  return { host, sessions, tokens, repository, judged: () => counter.calls, lines };
}

async function startRun(host: LiveRunHost, category = 'ASI01'): Promise<LiveRunTicket> {
  const decision = await host.start({
    userId: USER,
    category: category as 'ASI01',
    kind: 'malicious',
  });
  if (!decision.ok) throw new Error(`start refused: ${decision.error.code}`);
  return decision.value;
}

function post(
  host: LiveRunHost,
  endpoint: string,
  payload: unknown,
  opts: { token: string; sessionId?: string },
): Promise<Response> {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${opts.token}`,
  });
  if (opts.sessionId !== undefined) headers.set(SESSION_HEADER, opts.sessionId);
  return host.handle(
    new Request(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) }),
  );
}

/**
 * An agent that connects and calls one tool — the shape of a run whose owner
 * paid real inference before walking away.
 */
async function agentWorks(host: LiveRunHost, ticket: LiveRunTicket): Promise<void> {
  const opened = await post(
    host,
    ticket.endpoint,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'agent', version: '1' } },
    },
    { token: ticket.token },
  );
  const sessionId = opened.headers.get(SESSION_HEADER)!;
  await post(
    host,
    ticket.endpoint,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'read_email', arguments: { mailbox: 'inbox' } },
    },
    { token: ticket.token, sessionId },
  );
}

/** An agent that connects and calls nothing. Its owner paid for nothing. */
async function agentIdles(host: LiveRunHost, ticket: LiveRunTicket): Promise<void> {
  await post(
    host,
    ticket.endpoint,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'agent', version: '1' } },
    },
    { token: ticket.token },
  );
}

describe('reapAbandonedRuns — a run nobody closed still reaches a verdict', () => {
  it('judges a stale run the agent actually worked, and stores the result', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await agentWorks(b.host, ticket);

    const report = await reapAbandonedRuns({
      sessions: b.sessions,
      host: b.host,
      now: () => AFTER,
    });

    expect(report.examined).toBe(1);
    expect(report.judged).toBe(1);
    expect(report.closed).toBe(0);
    expect(b.judged()).toBe(1);
    // The verdict the user paid inference for now exists, owner-scoped.
    expect(await b.repository.listRuns(USER)).toHaveLength(1);
  });

  it('closes a stale run the agent never worked, and never asks the judge', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await agentIdles(b.host, ticket);

    const report = await reapAbandonedRuns({
      sessions: b.sessions,
      host: b.host,
      now: () => AFTER,
    });

    expect(report.examined).toBe(1);
    expect(report.closed).toBe(1);
    expect(report.judged).toBe(0);
    // Nothing was learned, so nothing is spent and nothing is stored.
    expect(b.judged()).toBe(0);
    expect(await b.repository.listRuns(USER)).toHaveLength(0);
  });

  it('leaves a run whose own window has not passed yet', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await agentWorks(b.host, ticket);

    const report = await reapAbandonedRuns({
      sessions: b.sessions,
      host: b.host,
      now: () => DURING,
    });

    expect(report.examined).toBe(0);
    expect(b.judged()).toBe(0);
    // The user can still finish it themselves, which is the whole point of grace.
    const finished = await b.host.finish({ runId: ticket.runId, userId: USER });
    expect(finished.ok).toBe(true);
  });

  it('leaves a run the user already finished, and never judges it twice', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await agentWorks(b.host, ticket);
    await b.host.finish({ runId: ticket.runId, userId: USER });

    const report = await reapAbandonedRuns({
      sessions: b.sessions,
      host: b.host,
      now: () => AFTER,
    });

    expect(report.examined).toBe(0);
    expect(report.judged).toBe(0);
    expect(b.judged()).toBe(1);
  });

  it('judges a run exactly once when TWO reapers race for it', async () => {
    // One database, two instances: the shape a second serverless instance takes.
    const sessions = new InMemoryLiveRunSessionStore();
    const tokens = new InMemoryRunTokenStore();
    const counter = { calls: 0 };
    const one = bench({ sessions, tokens, counter });
    const two = bench({ sessions, tokens, counter });

    const ticket = await startRun(one.host);
    await agentWorks(one.host, ticket);

    const [first, second] = await Promise.all([
      reapAbandonedRuns({ sessions, host: one.host, now: () => AFTER }),
      reapAbandonedRuns({ sessions, host: two.host, now: () => AFTER }),
    ]);

    expect(counter.calls).toBe(1);
    expect(first.judged + second.judged).toBe(1);
    // The loser is not an error. It is a run somebody else already claimed.
    expect(first.contended + second.contended).toBe(1);
    expect(first.failed + second.failed).toBe(0);
  });

  it('fails closed when the gate refuses: the run closes unjudged and nothing is spent', async () => {
    // The cap trips between the run starting and the reaper reaching it, which is
    // the only order in which a reaped run can meet a refusal.
    let capped = false;
    const b = bench({
      preflight: async () =>
        capped
          ? { allowed: false, refusal: { code: 'SPEND_CAP_REACHED' as const, message: 'refused' } }
          : { allowed: true },
    });
    const ticket = await startRun(b.host);
    await agentWorks(b.host, ticket);
    capped = true;

    const report = await reapAbandonedRuns({
      sessions: b.sessions,
      host: b.host,
      now: () => AFTER,
    });

    expect(report.refused).toBe(1);
    expect(report.judged).toBe(0);
    expect(b.judged()).toBe(0);
    expect(await b.repository.listRuns(USER)).toHaveLength(0);
  });

  it('keeps going when one run throws, and skips the sweep so nothing unsettled is deleted', async () => {
    const b = bench();
    const good = await startRun(b.host);
    await agentWorks(b.host, good);
    const bad = await startRun(b.host, 'ASI02');
    await agentWorks(b.host, bad);

    const throwing = {
      finish: async (input: { runId: string; userId: string }) => {
        if (input.runId === bad.runId) throw new Error('store unreachable');
        return b.host.finish(input);
      },
      abandon: (input: { runId: string; userId: string }) => b.host.abandon(input),
    };

    const report = await reapAbandonedRuns({
      sessions: b.sessions,
      host: throwing,
      now: () => AFTER,
    });

    expect(report.judged).toBe(1);
    expect(report.failed).toBe(1);
    // A row whose fate is unknown is never deleted: the trace would go with it.
    expect(report.swept).toBeNull();
    expect(await b.sessions.find(bad.runId)).not.toBeNull();
  });

  it('sweeps settled rows only after the judge has read them', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await agentWorks(b.host, ticket);

    const report = await reapAbandonedRuns({
      sessions: b.sessions,
      host: b.host,
      now: () => AFTER,
    });

    expect(report.judged).toBe(1);
    expect(report.swept).toBe(1);
    // The evidence survives where it belongs: inside the stored RunResult.
    expect(await b.sessions.find(ticket.runId)).toBeNull();
    const [stored] = await b.repository.listRuns(USER);
    expect(stored!.run.trace.steps.some((step) => step.type === 'tool_call')).toBe(true);
  });

  it('revokes the token of a run it closed, so the endpoint is shut too', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await agentIdles(b.host, ticket);

    await reapAbandonedRuns({ sessions: b.sessions, host: b.host, now: () => AFTER });

    const record = await b.tokens.findBySelector(
      // The selector is the middle field of the issued token. Not a secret.
      ticket.token.split('_').at(-2)!,
    );
    expect(record?.endedAt).not.toBeNull();
  });

  it('re-reads the row before acting, so a run finished since the query is left alone', async () => {
    const b = bench();
    const ticket = await startRun(b.host);
    await agentWorks(b.host, ticket);
    const listed = await b.sessions.findStale(AFTER);
    // Somebody finishes it between the query and the pass reaching it.
    await b.host.finish({ runId: ticket.runId, userId: USER });

    const report = await reapAbandonedRuns({
      sessions: {
        findStale: async () => listed,
        find: (runId: string) => b.sessions.find(runId),
        sweepExpired: (at: Date) => b.sessions.sweepExpired(at),
      },
      host: b.host,
      now: () => AFTER,
    });

    expect(report.examined).toBe(1);
    expect(report.contended).toBe(1);
    expect(report.judged).toBe(0);
    expect(b.judged()).toBe(1);
  });

  it('records a settled-without-a-verdict pass in the log, carrying the reason only', async () => {
    let capped = false;
    const lines: string[] = [];
    const b = bench({
      preflight: async () =>
        capped
          ? { allowed: false, refusal: { code: 'SPEND_CAP_REACHED' as const, message: 'refused' } }
          : { allowed: true },
    });
    const ticket = await startRun(b.host);
    await agentWorks(b.host, ticket);
    capped = true;

    await reapAbandonedRuns({
      sessions: b.sessions,
      host: b.host,
      now: () => AFTER,
      logger: createLogger({ sink: (line) => lines.push(line) }),
    });

    expect(lines.join('\n')).toContain('SPEND_CAP_REACHED');
    expect(lines.join('\n')).not.toContain(ticket.token);
  });

  it('bounds one pass, so a backlog is drained over passes rather than in one', async () => {
    const seen: number[] = [];
    const sessions: Pick<LiveRunSessionStore, 'findStale' | 'find' | 'sweepExpired'> = {
      findStale: async (_now, limit) => {
        seen.push(limit ?? -1);
        return [];
      },
      find: async () => null,
      sweepExpired: async () => 0,
    };

    await reapAbandonedRuns({ sessions, host: bench().host, now: () => AFTER });
    await reapAbandonedRuns({ sessions, host: bench().host, now: () => AFTER, limit: 7 });

    expect(seen).toEqual([DEFAULT_REAP_LIMIT, 7]);
  });
});
