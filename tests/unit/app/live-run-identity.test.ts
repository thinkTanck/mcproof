/**
 * WHERE THE ACCOUNT COMES FROM, ON EVERY PATH THAT WRITES.
 *
 * There are three places a run's owner is decided, and one rule for all of
 * them: it is read on the server from something the caller cannot set.
 *
 *   - the run-lifecycle actions read the verified session;
 *   - the hosted MCP endpoint reads the run record its per-run token resolved to;
 *   - the scheduled pass reads the run record it is settling.
 *
 * Each test below hands in an account id by a route a client controls (a body
 * field, a request header, a JSON-RPC parameter) and shows that it changed
 * nothing: the row, the run record and the recorded step all belong to the
 * account the server already knew about.
 */
import { InMemoryRunRepository } from '@/data/run-repository';
import { SESSION_HEADER } from '@/harness/server/http';
import { getUser } from '@/lib/auth/user';
import { SHELL_USER_HEADER } from '@/lib/shell-identity';
import { createLiveRunHost, type LiveRunHost } from '@/runs/live-run';
import { InMemoryLiveRunSessionStore } from '@/runs/live-run-store';
import { reapAbandonedRuns } from '@/runs/reaper';
import { createRunWriter } from '@/runs/run-writes';
import { InMemoryRunTokenStore } from '@/runs/run-token';
import { resetLiveRunRegistry } from '@/app/api/mcp/host';
import { discardLiveRun, finishLiveRun, startLiveRun } from '@/app/actions/live-run';

const OWNER = 'user-owner';
const ATTACKER = 'user-attacker';

let host: LiveRunHost;
let store: InMemoryRunRepository;
let sessions: InMemoryLiveRunSessionStore;
let sessionUser: string | null;
let clock: Date;

const headersRead = vi.fn();

vi.mock('@/lib/auth/user', () => ({ getUser: vi.fn() }));
vi.mock('@/app/api/mcp/host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/mcp/host')>();
  return { ...actual, getLiveRunHost: () => host };
});
// A request that carries a forged shell header. Nothing on a write path may read it.
vi.mock('next/headers', () => ({
  headers: async () => {
    headersRead();
    return new Headers({ 'x-shell-user-email': 'attacker%40example.com' });
  },
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

function signIn(id: string | null): void {
  sessionUser = id;
  vi.mocked(getUser).mockResolvedValue((id === null ? null : { id }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLiveRunRegistry();
  clock = new Date('2026-10-13T09:00:00.000Z');
  store = new InMemoryRunRepository();
  sessions = new InMemoryLiveRunSessionStore();
  signIn(OWNER);
  // The REAL writer, on its session identity, so the write-side check is in play.
  const writer = createRunWriter({
    store,
    records: sessions,
    identity: { from: 'session', userId: async () => sessionUser },
  });
  host = createLiveRunHost({
    preflight: async () => ({ allowed: true }),
    tokens: new InMemoryRunTokenStore(),
    sessions,
    repository: {
      saveRun: (userId, run) => writer.saveRun(userId, run),
      saveDiscardedRun: (userId, marker) => writer.saveDiscardedRun(userId, marker),
      findByRunId: (userId, runId) => store.findByRunId(userId, runId),
      findDiscardedByRunId: (userId, runId) => store.findDiscardedByRunId(userId, runId),
    },
    resolveDetector: () => async (trace) => ({
      runId: trace.runId,
      compromised: false,
      score: 0,
      severity: 'None',
      category: trace.category,
      rationale: 'clean',
    }),
    origin: 'https://mcproof.test',
    now: () => clock,
  });
});

async function start() {
  const answer = await startLiveRun({ category: 'ASI01' });
  if (!answer.ok) throw new Error(answer.code);
  return answer.value;
}

/** One request to the hosted endpoint, with whatever extra headers a client likes. */
async function agentCall(
  ticket: { endpoint: string; token: string },
  payload: unknown,
  extra: Record<string, string> = {},
): Promise<Response> {
  return host.handle(
    new Request(ticket.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${ticket.token}`,
        ...extra,
      },
      body: JSON.stringify(payload),
    }),
  );
}

describe('creating a run', () => {
  it('records the run under the session account', async () => {
    const ticket = await start();

    expect((await sessions.find(ticket.runId))?.userId).toBe(OWNER);
  });

  it('refuses a body that names an account, and creates nothing', async () => {
    const answer = await startLiveRun({ category: 'ASI01', userId: ATTACKER });

    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.code).toBe('INVALID_REQUEST');
    expect(await sessions.findStale(new Date('2999-01-01T00:00:00.000Z'))).toEqual([]);
  });

  it.each(['user_id', 'owner', 'account'])(
    'refuses a body that smuggles the account as "%s"',
    async (key) => {
      const answer = await startLiveRun({ category: 'ASI01', [key]: ATTACKER });

      expect(answer.ok).toBe(false);
      expect(await sessions.findStale(new Date('2999-01-01T00:00:00.000Z'))).toEqual([]);
    },
  );

  it('never reads a request header to decide who is asking', async () => {
    await start();

    expect(headersRead).not.toHaveBeenCalled();
  });
});

describe('finishing a run', () => {
  it('writes the result under the session account, forged shell header or not', async () => {
    const ticket = await start();

    const answer = await finishLiveRun({ runId: ticket.runId });

    expect(answer.ok).toBe(true);
    expect((await store.listRuns(OWNER)).map((row) => row.run.runId)).toEqual([ticket.runId]);
    expect(await store.countRunsSince(ATTACKER, new Date(0))).toBe(0);
    expect(headersRead).not.toHaveBeenCalled();
  });

  it('refuses a body that names an account, and writes nothing', async () => {
    const ticket = await start();

    const answer = await finishLiveRun({ runId: ticket.runId, userId: OWNER });

    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.code).toBe('INVALID_REQUEST');
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(0);
    // And the run was not claimed by the refused request: its owner can still end it.
    expect((await sessions.find(ticket.runId))?.finishedAt).toBeNull();
  });

  it('gives another signed-in account the answer an unknown id gets, and writes nothing', async () => {
    const ticket = await start();
    signIn(ATTACKER);

    const theirs = await finishLiveRun({ runId: ticket.runId });
    const unknown = await finishLiveRun({ runId: 'run-that-never-existed' });

    expect(theirs).toEqual(unknown);
    if (!theirs.ok) expect(theirs.code).toBe('RUN_NOT_FOUND');
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(0);
    expect(await store.countRunsSince(ATTACKER, new Date(0))).toBe(0);
    expect((await sessions.find(ticket.runId))?.finishedAt).toBeNull();
  });
});

describe('discarding a run', () => {
  it('writes the marker under the session account', async () => {
    const ticket = await start();

    const answer = await discardLiveRun({ runId: ticket.runId });

    expect(answer.ok).toBe(true);
    expect((await store.listDiscardedRuns(OWNER)).map((row) => row.discarded.runId)).toEqual([
      ticket.runId,
    ]);
    expect(await store.listDiscardedRuns(ATTACKER)).toEqual([]);
    expect(headersRead).not.toHaveBeenCalled();
  });

  it('gives another signed-in account the answer an unknown id gets, and writes nothing', async () => {
    const ticket = await start();
    signIn(ATTACKER);

    const theirs = await discardLiveRun({ runId: ticket.runId });
    const unknown = await discardLiveRun({ runId: 'run-that-never-existed' });

    expect(theirs).toEqual(unknown);
    expect(await store.countRunsSince(OWNER, new Date(0))).toBe(0);
    expect(await store.countRunsSince(ATTACKER, new Date(0))).toBe(0);
    expect((await sessions.find(ticket.runId))?.finishedAt).toBeNull();
  });
});

describe('the hosted MCP endpoint', () => {
  it('records the agent’s steps on the run its token resolved to, whatever else the request claims', async () => {
    const ticket = await start();
    const forged = { [SHELL_USER_HEADER]: 'attacker%40example.com', 'x-user-id': ATTACKER };

    const opened = await agentCall(
      ticket,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          clientInfo: { name: 'identity-test-agent' },
          userId: ATTACKER,
        },
      },
      forged,
    );
    const session = opened.headers.get(SESSION_HEADER) as string;
    await agentCall(
      ticket,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { userId: ATTACKER } },
      { ...forged, [SESSION_HEADER]: session },
    );

    const record = await sessions.find(ticket.runId);
    expect(opened.status).toBe(200);
    expect(record?.userId).toBe(OWNER);
    expect(JSON.stringify(record)).not.toContain(ATTACKER);
    expect(await store.countRunsSince(ATTACKER, new Date(0))).toBe(0);
  });

  it('refuses a request with no token even when it names the owner in a header', async () => {
    const ticket = await start();
    const before = (await sessions.find(ticket.runId))?.events.length;

    const response = await host.handle(
      new Request(ticket.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-user-id': OWNER,
          [SHELL_USER_HEADER]: 'owner%40example.com',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );

    expect(response.status).toBe(401);
    expect((await sessions.find(ticket.runId))?.events.length).toBe(before);
  });
});

describe('the scheduled pass', () => {
  it('writes a reaped result under the owner the run record names, with no session at all', async () => {
    const ticket = await start();
    const opened = await agentCall(ticket, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'identity-test-agent' } },
    });
    const listed = await agentCall(
      ticket,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { [SESSION_HEADER]: opened.headers.get(SESSION_HEADER) as string },
    );
    const tool = ((await listed.json()) as { result: { tools: { name: string }[] } }).result
      .tools[0]!.name;
    await agentCall(
      ticket,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: tool, arguments: {} } },
      { [SESSION_HEADER]: opened.headers.get(SESSION_HEADER) as string },
    );

    // The pass has no session: its writer takes the owner from the run record.
    const recordWriter = createRunWriter({
      store,
      records: sessions,
      identity: { from: 'run-record' },
    });
    const later = new Date('2026-12-01T00:00:00.000Z');
    const passHost = createLiveRunHost({
      preflight: async () => ({ allowed: true }),
      tokens: new InMemoryRunTokenStore(),
      sessions,
      repository: { saveRun: (userId, run) => recordWriter.saveRun(userId, run) },
      resolveDetector: () => async (trace) => ({
        runId: trace.runId,
        compromised: false,
        score: 0,
        severity: 'None',
        category: trace.category,
        rationale: 'clean',
      }),
      origin: 'https://mcproof.test',
      now: () => later,
    });
    signIn(null);

    const report = await reapAbandonedRuns({ sessions, host: passHost, now: () => later });

    expect(report.judged).toBe(1);
    expect((await store.listRuns(OWNER)).map((row) => row.run.runId)).toEqual([ticket.runId]);
    expect(await store.countRunsSince(ATTACKER, new Date(0))).toBe(0);
  });
});
