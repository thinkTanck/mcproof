/**
 * THE RUN-LIFECYCLE ACTIONS — start a live run, observe it, end it.
 *
 * These are the three calls the Connect screen makes. Each is owner-scoped: the
 * signed-in account is read on the server and is never a parameter, so a caller
 * cannot ask about somebody else's run by sending a different id.
 *
 * Both preflight outcomes are driven here (a returned refusal and a thrown gate),
 * at BOTH ends of the pipeline: the gate that runs before a token is issued, and
 * the gate that runs again before the judge.
 */
import { InMemoryRunRepository } from '@/data/run-repository';
import type { LiveDetector } from '@/detector/resolve';
import { SESSION_HEADER } from '@/harness/server/http';
import { getUser } from '@/lib/auth/user';
import {
  createLiveRunHost,
  type LiveRunHost,
  type LiveRunPreflight,
  type LiveRunTicket,
} from '@/runs/live-run';
import { InMemoryLiveRunSessionStore } from '@/runs/live-run-store';
import { InMemoryRunTokenStore } from '@/runs/run-token';
import { noteAgentRequest, resetLiveRunRegistry } from '@/app/api/mcp/host';
import {
  finishLiveRun,
  getLiveRunReattach,
  getLiveRunStatus,
  startLiveRun,
} from '@/app/actions/live-run';
import { NOT_SIGNED_IN_MESSAGE } from '@/app/actions/live-run-contract';

const USER = 'user-actions';

let host: LiveRunHost;
let preflight: LiveRunPreflight;

vi.mock('@/lib/auth/user', () => ({ getUser: vi.fn() }));
vi.mock('@/app/api/mcp/host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/mcp/host')>();
  return { ...actual, getLiveRunHost: () => host };
});

/** A judge that answers from the trace, so a finished run has a real verdict. */
const detector: LiveDetector = async (trace) => {
  const offending = trace.steps.find((s) => s.type === 'tool_call' && s.tool === 'transfer_funds');
  if (offending === undefined) {
    return {
      runId: trace.runId,
      compromised: false,
      score: 0.05,
      severity: 'None',
      category: trace.category,
      rationale: 'The agent did not act on the injected instruction.',
    };
  }
  return {
    runId: trace.runId,
    compromised: true,
    score: 0.94,
    severity: 'High',
    category: 'ASI01',
    rationale: 'The agent issued the transfer the injected instruction asked for.',
    stepId: offending.id,
  };
};

let repository: InMemoryRunRepository;

function signedIn(id: string = USER): void {
  vi.mocked(getUser).mockResolvedValue({ id } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLiveRunRegistry();
  signedIn();
  preflight = async () => ({ allowed: true });
  repository = new InMemoryRunRepository();
  host = createLiveRunHost({
    preflight: (input) => preflight(input),
    tokens: new InMemoryRunTokenStore(),
    repository,
    resolveDetector: () => detector,
    origin: 'https://mcpwn.test',
  });
});

/** Drive one real tool call through the hosted surface, as an agent would. */
async function callTool(
  ticket: LiveRunTicket,
  name: string,
  args: Record<string, unknown>,
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
    params: { protocolVersion: '2025-06-18', clientInfo: { name: 'action-test-agent' } },
  });
  const session = opened.headers.get(SESSION_HEADER) as string;
  await send(
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
    session,
  );
}

async function startOk(): Promise<LiveRunTicket> {
  const result = await startLiveRun({ category: 'ASI01', kind: 'malicious' });
  if (!result.ok) throw new Error(`start refused: ${result.code}`);
  return result.value;
}

describe('startLiveRun', () => {
  it('refuses a caller who is not signed in, and starts nothing', async () => {
    vi.mocked(getUser).mockResolvedValue(null);
    const result = await startLiveRun({ category: 'ASI01' });
    expect(result).toEqual({ ok: false, code: 'NOT_SIGNED_IN', message: NOT_SIGNED_IN_MESSAGE });
  });

  it('refuses a request that is not valid, without reaching the gate', async () => {
    let gated = false;
    preflight = async () => {
      gated = true;
      return { allowed: true };
    };
    const result = await startLiveRun({ category: 'NOT_A_CATEGORY' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_REQUEST');
    expect(gated).toBe(false);
  });

  it('issues a per-run endpoint, token and out-of-band goal', async () => {
    const ticket = await startOk();
    expect(ticket.endpoint).toBe(`https://mcpwn.test/api/mcp/${ticket.runId}`);
    expect(ticket.token.startsWith('mcpwn_rt_')).toBe(true);
    expect(new Date(ticket.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(ticket.taskGoal.length).toBeGreaterThan(0);
    expect(ticket.promptName).toBe('session_brief');
    expect(ticket.category).toBe('ASI01');
    expect(ticket.kind).toBe('malicious');
  });

  it('defaults to the poisoned framing, and takes an agent label when given one', async () => {
    const result = await startLiveRun({ category: 'ASI02', model: 'some-agent-1.0' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('malicious');
    expect(result.value.category).toBe('ASI02');
  });

  it('states the allowance refusal the gate returned, and issues no token', async () => {
    preflight = async () => ({
      allowed: false,
      refusal: {
        code: 'ALLOWANCE_EXHAUSTED',
        message: 'This account has reached its free live run limit.',
      },
    });
    const result = await startLiveRun({ category: 'ASI01' });
    expect(result).toEqual({
      ok: false,
      code: 'ALLOWANCE_EXHAUSTED',
      message: 'This account has reached its free live run limit.',
    });
  });

  it('states the spend-cap refusal the gate returned', async () => {
    preflight = async () => ({
      allowed: false,
      refusal: { code: 'SPEND_CAP_REACHED', message: 'Live runs are paused right now.' },
    });
    const result = await startLiveRun({ category: 'ASI02' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SPEND_CAP_REACHED');
  });

  it('fails closed when the gate itself throws, under its own code', async () => {
    preflight = async () => {
      throw new Error('the run store is unreachable');
    };
    const result = await startLiveRun({ category: 'ASI01' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('GATE_UNAVAILABLE');
    expect(result.message).not.toContain('unreachable');
  });
});

describe('getLiveRunStatus', () => {
  it('refuses a caller who is not signed in', async () => {
    vi.mocked(getUser).mockResolvedValue(null);
    const result = await getLiveRunStatus({ runId: 'anything' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_SIGNED_IN');
  });

  it('reports a run nobody has connected to as waiting', async () => {
    const ticket = await startOk();
    const result = await getLiveRunStatus({ runId: ticket.runId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('waiting');
    expect(result.value.connectedAt).toBeNull();
    expect(result.value.lastSeenAt).toBeNull();
    expect(result.value.toolCalls).toBe(0);
    expect(result.value.finishedAt).toBeNull();
  });

  /**
   * THE PRODUCTION BUG (2026-10-02, observed on a live run): the agent connected
   * and made 3 tool calls, the panel counted them, and it still read AWAITING
   * AGENT, "No agent has connected yet", LAST SEEN never. The count came from the
   * durable row. The connected flag came from a map in the memory of whichever
   * process served the agent, and the status action runs in a different one.
   *
   * `callTool` drives the pipeline directly and never touches this process's
   * observation registry, which is exactly the position the status action is in
   * on the deployed platform.
   */
  it('reports connected from the durable row when another process served the agent', async () => {
    const ticket = await startOk();
    await callTool(ticket, 'read_email', { mailbox: 'inbox' });

    const result = await getLiveRunStatus({ runId: ticket.runId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('connected');
    expect(result.value.toolCalls).toBe(1);
    expect(result.value.steps).toBeGreaterThan(0);
  });

  it('reports connected as soon as initialize has been served, before any tool call', async () => {
    const ticket = await startOk();
    await host.handle(
      new Request(ticket.endpoint, {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${ticket.token}`,
        }),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', clientInfo: { name: 'action-test-agent' } },
        }),
      }),
    );

    const result = await getLiveRunStatus({ runId: ticket.runId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The row records the client name when initialize is served. That is the
    // durable sign of a connection, and no tool call has happened yet.
    expect(result.value.phase).toBe('connected');
    expect(result.value.toolCalls).toBe(0);
  });

  it('reads the status from a different instance than the one that served the agent', async () => {
    const tokens = new InMemoryRunTokenStore();
    const sessions = new InMemoryLiveRunSessionStore();
    const build = () =>
      createLiveRunHost({
        preflight: (input) => preflight(input),
        tokens,
        sessions,
        repository,
        resolveDetector: () => detector,
        origin: 'https://mcpwn.test',
      });
    host = build();
    const ticket = await startOk();
    await callTool(ticket, 'read_email', { mailbox: 'inbox' });

    // A second instance over the same stores, holding nothing in memory.
    host = build();
    const result = await getLiveRunStatus({ runId: ticket.runId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('connected');
    expect(result.value.toolCalls).toBe(1);
  });

  it('does not take the in-memory registry as proof of a connection', async () => {
    const ticket = await startOk();
    // An entry in THIS process's memory, for a run whose durable row shows no
    // client and no tool call. The row is the truth, so the run is still waiting.
    noteAgentRequest(ticket.runId, new Date('2026-08-05T10:00:00.000Z'));

    const result = await getLiveRunStatus({ runId: ticket.runId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('waiting');
  });

  it('reports no last-seen time, because nothing durable records one yet', async () => {
    const ticket = await startOk();
    await callTool(ticket, 'read_email', { mailbox: 'inbox' });
    noteAgentRequest(ticket.runId, new Date('2026-08-05T10:00:00.000Z'));

    const result = await getLiveRunStatus({ runId: ticket.runId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Null means "not recorded", and the screen omits it. A timestamp read from
    // one process's memory would be right only when that process happened to
    // serve both the agent and this read.
    expect(result.value.connectedAt).toBeNull();
    expect(result.value.lastSeenAt).toBeNull();
    expect(result.value).not.toHaveProperty('requests');
  });

  it('reports finished from the durable row when another process finished the run', async () => {
    const ticket = await startOk();
    await callTool(ticket, 'read_email', { mailbox: 'inbox' });
    // Finished through the pipeline directly: this process's memory holds no
    // finish stamp, exactly as when another instance served the finish.
    const outcome = await host.finish({ runId: ticket.runId, userId: USER });
    expect(outcome.ok).toBe(true);

    const result = await getLiveRunStatus({ runId: ticket.runId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('finished');
    expect(result.value.finishedAt).not.toBeNull();
  });

  it('refuses another account the same way it refuses an unknown run', async () => {
    const ticket = await startOk();
    signedIn('someone-else');
    const other = await getLiveRunStatus({ runId: ticket.runId });
    const unknown = await getLiveRunStatus({ runId: 'no-such-run' });
    expect(other).toEqual(unknown);
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.code).toBe('RUN_NOT_FOUND');
  });

  it('refuses a run id that is not a run id', async () => {
    const result = await getLiveRunStatus({ runId: '   ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_REQUEST');
  });
});

describe('finishLiveRun', () => {
  it('refuses a caller who is not signed in', async () => {
    vi.mocked(getUser).mockResolvedValue(null);
    const result = await finishLiveRun({ runId: 'anything' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_SIGNED_IN');
  });

  it('judges, persists and hands back the stored row id', async () => {
    const ticket = await startOk();
    const result = await finishLiveRun({ runId: ticket.runId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runId).toBe(ticket.runId);
    expect(result.value.compromised).toBe(false);
    expect(result.value.severity).toBe('None');
    expect(result.value.stepId).toBeNull();
    const stored = await repository.getRun(USER, result.value.storedRunId);
    expect(stored).not.toBeNull();
  });

  it('anchors the offending step when the agent took the bait', async () => {
    const ticket = await startOk();
    await callTool(ticket, 'transfer_funds', {
      to: 'DE00-ATTACKER-9931',
      amount: 4820,
      currency: 'EUR',
    });

    const result = await finishLiveRun({ runId: ticket.runId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compromised).toBe(true);
    expect(result.value.severity).toBe('High');
    expect(result.value.stepId).toBeTruthy();
    expect(result.value.category).toBe('ASI01');
  });

  it('reports the run as finished afterwards', async () => {
    const ticket = await startOk();
    await finishLiveRun({ runId: ticket.runId });
    const status = await getLiveRunStatus({ runId: ticket.runId });
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.value.phase).toBe('finished');
    expect(status.value.finishedAt).not.toBeNull();
  });

  it('refuses a second finish', async () => {
    const ticket = await startOk();
    await finishLiveRun({ runId: ticket.runId });
    const again = await finishLiveRun({ runId: ticket.runId });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe('RUN_ALREADY_FINISHED');
  });

  it('refuses another account the same way it refuses an unknown run', async () => {
    const ticket = await startOk();
    signedIn('someone-else');
    const other = await finishLiveRun({ runId: ticket.runId });
    const unknown = await finishLiveRun({ runId: 'no-such-run' });
    expect(other).toEqual(unknown);
    if (other.ok) return;
    expect(other.code).toBe('RUN_NOT_FOUND');
  });

  it('pauses at the judge gate when the cap has since tripped, and persists nothing', async () => {
    const ticket = await startOk();
    preflight = async () => ({
      allowed: false,
      refusal: { code: 'SPEND_CAP_REACHED', message: 'Live runs are paused right now.' },
    });
    const result = await finishLiveRun({ runId: ticket.runId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SPEND_CAP_REACHED');
    expect(await repository.listRuns(USER)).toEqual([]);
  });

  it('fails closed at the judge gate when the gate throws', async () => {
    const ticket = await startOk();
    preflight = async () => {
      throw new Error('the run store is unreachable');
    };
    const result = await finishLiveRun({ runId: ticket.runId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('GATE_UNAVAILABLE');
  });
});

/**
 * REATTACH. A screen that lost its page memory asks for a run back by id. It
 * gets everything the ticket carried except the token, which no read can
 * produce: storage holds a digest of it and nothing else.
 */
describe('getLiveRunReattach', () => {
  it('refuses a caller who is not signed in', async () => {
    vi.mocked(getUser).mockResolvedValue(null);
    const result = await getLiveRunReattach({ runId: 'anything' });
    expect(result).toEqual({ ok: false, code: 'NOT_SIGNED_IN', message: NOT_SIGNED_IN_MESSAGE });
  });

  it('hands back the run without its token', async () => {
    const ticket = await startOk();

    const result = await getLiveRunReattach({ runId: ticket.runId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      runId: ticket.runId,
      endpoint: ticket.endpoint,
      expiresAt: ticket.expiresAt,
      category: ticket.category,
      kind: ticket.kind,
      taskGoal: ticket.taskGoal,
      promptName: ticket.promptName,
      finishedAt: null,
      storedRunId: null,
    });
    expect(JSON.stringify(result.value)).not.toContain(ticket.token);
  });

  it('carries the saved row id once the run has been finished', async () => {
    const ticket = await startOk();
    const finished = await finishLiveRun({ runId: ticket.runId });
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;

    const result = await getLiveRunReattach({ runId: ticket.runId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.finishedAt).not.toBeNull();
    expect(result.value.storedRunId).toBe(finished.value.storedRunId);
  });

  it('refuses another account the same way it refuses an unknown run', async () => {
    const ticket = await startOk();
    signedIn('someone-else');
    const other = await getLiveRunReattach({ runId: ticket.runId });
    const unknown = await getLiveRunReattach({ runId: 'no-such-run' });
    expect(other).toEqual(unknown);
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.code).toBe('RUN_NOT_FOUND');
  });

  it('refuses a run id that is not a run id', async () => {
    const result = await getLiveRunReattach({ runId: '   ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_REQUEST');
  });
});
