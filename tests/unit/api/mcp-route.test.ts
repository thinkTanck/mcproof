/**
 * THE HOSTED MCP ENDPOINT, AT THE ROUTE.
 *
 * Every test here drives a real `Request` through the real route handlers. The
 * only thing replaced is the PRODUCTION wiring of the host (Supabase, the live
 * judge): the host itself is the real `createLiveRunHost`, so the token check,
 * the Streamable HTTP contract and the recorder are all exercised for real.
 *
 * This endpoint is inbound attack surface by design
 * ([ADR-0006](docs/adr/0006-mcpwn-is-the-mcp-server.md)), so the refusals are
 * asserted to be INDISTINGUISHABLE: an unknown run, a missing token, a malformed
 * token, another run's token and an expired token all get one answer.
 */
import { InMemoryRunRepository } from '@/data/run-repository';
import type { LiveDetector } from '@/detector/resolve';
import { SESSION_HEADER } from '@/harness/server/http';
import { findPayloadTells, findTells } from '@/harness/server/surface';
import {
  createLiveRunHost,
  type LiveRunHost,
  type LiveRunPreflight,
  type LiveRunTicket,
} from '@/runs/live-run';
import { InMemoryRunTokenStore, RUN_TOKEN_REJECTION_MESSAGE } from '@/runs/run-token';
import { DELETE, GET, MAX_MCP_BODY_BYTES, POST } from '@/app/api/mcp/[runId]/route';
import { readAgentActivity, resetLiveRunRegistry } from '@/app/api/mcp/host';

const USER = 'user-route';
const ORIGIN = 'https://mcproof.test';

/** The host the route reaches for. Rebuilt per test, with in-memory everything. */
let host: LiveRunHost;
/** Injected clock, so an expiring token needs no sleeping. */
let clock: Date;

vi.mock('@/app/api/mcp/host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/api/mcp/host')>();
  return { ...actual, getLiveRunHost: () => host };
});

const grant: LiveRunPreflight = async () => ({ allowed: true });

/** A detector that never has to be right here: finishing is tested elsewhere. */
const detector: LiveDetector = async (trace) => ({
  runId: trace.runId,
  compromised: false,
  score: 0,
  severity: 'None',
  category: trace.category,
  rationale: 'Nothing in this trace acts on the injected content.',
});

let tokens: InMemoryRunTokenStore;

beforeEach(() => {
  resetLiveRunRegistry();
  clock = new Date('2026-08-05T10:00:00.000Z');
  tokens = new InMemoryRunTokenStore();
  host = createLiveRunHost({
    preflight: grant,
    tokens,
    repository: new InMemoryRunRepository(),
    resolveDetector: () => detector,
    origin: ORIGIN,
    now: () => clock,
  });
});

async function start(): Promise<LiveRunTicket> {
  const decision = await host.start({ userId: USER, category: 'ASI01', kind: 'malicious' });
  if (!decision.ok) throw new Error(`start refused: ${decision.error.code}`);
  return decision.value;
}

/** One JSON-RPC message, as an agent would send it. */
function mcpRequest(
  ticket: { endpoint: string },
  token: string | null,
  payload: unknown,
  sessionId?: string,
): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  });
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  if (sessionId !== undefined) headers.set(SESSION_HEADER, sessionId);
  return new Request(ticket.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
}

/** Open a session the way a real client does, and hand back its id. */
async function openSession(ticket: LiveRunTicket): Promise<string> {
  const opened = await POST(
    mcpRequest(ticket, ticket.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'route-test-agent', version: '1.0' },
      },
    }),
  );
  expect(opened.status).toBe(200);
  const session = opened.headers.get(SESSION_HEADER);
  expect(session).toBeTruthy();
  return session as string;
}

describe('POST /api/mcp/[runId] — the agent connects, calls and is recorded', () => {
  it('serves initialize, mints a session and records the connection', async () => {
    const ticket = await start();
    const session = await openSession(ticket);
    expect(session).not.toContain(ticket.runId);

    const activity = readAgentActivity(ticket.runId);
    expect(activity).not.toBeNull();
    expect(activity?.requests).toBe(1);
  });

  /**
   * THE PRODUCTION BUG (2026-10-01), measured against the deployed endpoint.
   * This test used to assert "202 and no body". On the platform we deploy to, a
   * response from this route with a NULL body and any status but 204 has its
   * headers sent and its body never terminated: the response never completes.
   * The same 404 from the same route completed in 614 ms with a body and never
   * completed without one. `notifications/initialized` is the second request
   * every real client sends, and Claude Code 2.1.287 waits for its answer to
   * finish, so it timed out there (CONNECT_TIMEOUT, 30 s), retried three times
   * and reported the server as failed. Nothing local showed it: the same code
   * completes instantly under `next start`.
   */
  it('acknowledges a lone notification with 202 and a body, so the response actually completes', async () => {
    const ticket = await start();
    const session = await openSession(ticket);
    const res = await POST(
      mcpRequest(
        ticket,
        ticket.token,
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        session,
      ),
    );
    expect(res.status).toBe(202);
    expect(res.body).not.toBeNull();
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  it('records the tool call the agent chose to make', async () => {
    const ticket = await start();
    const session = await openSession(ticket);
    const res = await POST(
      mcpRequest(
        ticket,
        ticket.token,
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'read_email', arguments: { mailbox: 'inbox' } },
        },
        session,
      ),
    );
    expect(res.status).toBe(200);

    const trace = await host.getTrace({ runId: ticket.runId, userId: USER });
    expect(trace.ok).toBe(true);
    if (!trace.ok) return;
    expect(trace.value.steps.some((s) => s.type === 'tool_call' && s.tool === 'read_email')).toBe(
      true,
    );
  });

  it('answers a single SSE frame when the client accepts only text/event-stream', async () => {
    const ticket = await start();
    const request = new Request(ticket.endpoint, {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: `Bearer ${ticket.token}`,
      }),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', clientInfo: { name: 'sse-agent' } },
      }),
    });
    const res = await POST(request);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(await res.text()).toContain('event: message');
  });
});

describe('POST /api/mcp/[runId] — the refusals are one refusal', () => {
  /** Every refusal below must be byte-identical to this one. */
  async function refusalShape(res: Response): Promise<{ status: number; body: unknown }> {
    return { status: res.status, body: await res.json() };
  }

  it('refuses a missing token', async () => {
    const ticket = await start();
    const res = await POST(
      mcpRequest(ticket, null, { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: RUN_TOKEN_REJECTION_MESSAGE });
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('refuses a malformed token exactly as it refuses a missing one', async () => {
    const ticket = await start();
    const missing = await refusalShape(
      await POST(mcpRequest(ticket, null, { jsonrpc: '2.0', id: 1, method: 'tools/list' })),
    );
    const malformed = await refusalShape(
      await POST(
        mcpRequest(ticket, 'not-a-token', { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      ),
    );
    expect(malformed).toEqual(missing);
  });

  it('refuses a valid token presented at ANOTHER run', async () => {
    const first = await start();
    const second = await start();
    expect(second.runId).not.toBe(first.runId);

    const res = await POST(
      mcpRequest({ endpoint: second.endpoint }, first.token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: RUN_TOKEN_REJECTION_MESSAGE });
    // Nothing was recorded for the run whose endpoint was addressed.
    expect(readAgentActivity(second.runId)).toBeNull();
  });

  it('refuses an expired token', async () => {
    const ticket = await start();
    clock = new Date(new Date(ticket.expiresAt).getTime() + 1_000);
    const res = await POST(
      mcpRequest(ticket, ticket.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: RUN_TOKEN_REJECTION_MESSAGE });
  });

  it('refuses once the run has finished', async () => {
    const ticket = await start();
    await openSession(ticket);
    const finished = await host.finish({ runId: ticket.runId, userId: USER });
    expect(finished.ok).toBe(true);

    const res = await POST(
      mcpRequest(ticket, ticket.token, { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: RUN_TOKEN_REJECTION_MESSAGE });
  });

  it('refuses an unknown run with the same answer, so runs cannot be enumerated', async () => {
    const ticket = await start();
    const known = await refusalShape(
      await POST(
        mcpRequest(ticket, 'not-a-token', { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      ),
    );
    const unknown = await refusalShape(
      await POST(
        mcpRequest(
          { endpoint: `${ORIGIN}/api/mcp/00000000-0000-4000-8000-000000000000` },
          ticket.token,
          { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        ),
      ),
    );
    expect(unknown).toEqual(known);
  });

  it('refuses a run id outside the grammar with that same answer', async () => {
    const ticket = await start();
    const known = await refusalShape(
      await POST(
        mcpRequest(ticket, 'not-a-token', { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      ),
    );
    const weird = await refusalShape(
      await POST(
        mcpRequest({ endpoint: `${ORIGIN}/api/mcp/..%2F..%2Fetc` }, ticket.token, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
      ),
    );
    expect(weird).toEqual(known);
  });

  it('says nothing an agent could read as a tell', async () => {
    const ticket = await start();
    const res = await POST(
      mcpRequest(ticket, null, { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    );
    const body = (await res.text()).toLowerCase();
    for (const tell of ['mcproof', 'attack', 'red team', 'asi01', 'poison']) {
      expect(body).not.toContain(tell);
    }
  });
});

/**
 * THE TWO ANSWERS THIS ROUTE WRITES ITSELF: the one refusal (401) and the body
 * cap (413). Both reach an agent's client before any surface does, so both are
 * held to the neutrality list and to the payload list. The run origin used in
 * this file is a reserved name, so the ENDPOINT is deliberately not swept here:
 * what an issued endpoint says about itself is pinned in the live-run tests.
 */
describe('POST /api/mcp/[runId] — the route says nothing that is a tell of either kind', () => {
  const sweep = async (res: Response): Promise<string> => {
    const headers = [...res.headers.entries()].map(([name, value]) => `${name}: ${value}`);
    const seen = [await res.text(), res.statusText, ...headers].join('\n');
    expect(findTells(seen), seen).toEqual([]);
    expect(findPayloadTells(seen), seen).toEqual([]);
    return seen;
  };

  it('the 401 refusal sentence is neutral, as a constant and on the wire', async () => {
    expect(findTells(RUN_TOKEN_REJECTION_MESSAGE)).toEqual([]);
    expect(findPayloadTells(RUN_TOKEN_REJECTION_MESSAGE)).toEqual([]);

    const ticket = await start();
    const res = await POST(
      mcpRequest(ticket, null, { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    );
    expect(res.status).toBe(401);
    expect(await sweep(res)).toContain(RUN_TOKEN_REJECTION_MESSAGE);
  });

  it('the 413 body-cap answer is neutral', async () => {
    const ticket = await start();
    const res = await POST(
      new Request(ticket.endpoint, {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${ticket.token}`,
          'content-length': String(MAX_MCP_BODY_BYTES + 1),
        }),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(res.status).toBe(413);
    expect(await sweep(res)).toContain('Request body is too large.');
  });
});

describe('POST /api/mcp/[runId] — untrusted bodies are bounded', () => {
  it('refuses a body over the cap before it reaches the surface', async () => {
    const ticket = await start();
    const oversize = 'x'.repeat(MAX_MCP_BODY_BYTES + 1);
    const res = await POST(
      new Request(ticket.endpoint, {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${ticket.token}`,
        }),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { oversize } }),
      }),
    );
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
    expect(readAgentActivity(ticket.runId)).toBeNull();
  });

  it('refuses an oversize body declared by content-length without reading it', async () => {
    const ticket = await start();
    const res = await POST(
      new Request(ticket.endpoint, {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${ticket.token}`,
          'content-length': String(MAX_MCP_BODY_BYTES + 1),
        }),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(res.status).toBe(413);
  });

  it('answers malformed JSON with a JSON-RPC parse error, never a stack trace', async () => {
    const ticket = await start();
    const res = await POST(
      new Request(ticket.endpoint, {
        method: 'POST',
        headers: new Headers({
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${ticket.token}`,
        }),
        body: '{ this is not json',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
    expect(JSON.stringify(body)).not.toContain('at ');
  });

  it('refuses a body that is not JSON at all', async () => {
    const ticket = await start();
    const res = await POST(
      new Request(ticket.endpoint, {
        method: 'POST',
        headers: new Headers({
          'content-type': 'text/plain',
          accept: 'application/json',
          authorization: `Bearer ${ticket.token}`,
        }),
        body: 'hello',
      }),
    );
    expect(res.status).toBe(415);
  });
});

describe('GET and DELETE /api/mcp/[runId]', () => {
  it('answers GET with 405, because no server-initiated stream is served', async () => {
    const ticket = await start();
    const res = await GET(
      new Request(ticket.endpoint, {
        method: 'GET',
        headers: new Headers({ authorization: `Bearer ${ticket.token}` }),
      }),
    );
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('POST');
  });

  it('refuses an unauthenticated GET before it learns the method is not allowed', async () => {
    const ticket = await start();
    const res = await GET(new Request(ticket.endpoint, { method: 'GET' }));
    expect(res.status).toBe(401);
  });

  it('ends a session on DELETE', async () => {
    const ticket = await start();
    const session = await openSession(ticket);
    const res = await DELETE(
      new Request(ticket.endpoint, {
        method: 'DELETE',
        headers: new Headers({
          authorization: `Bearer ${ticket.token}`,
          [SESSION_HEADER]: session,
        }),
      }),
    );
    expect(res.status).toBe(204);
  });

  it('refuses an unauthenticated DELETE', async () => {
    const ticket = await start();
    const res = await DELETE(new Request(ticket.endpoint, { method: 'DELETE' }));
    expect(res.status).toBe(401);
  });

  it('answers a DELETE for a malformed session id with a 404 that carries a body', async () => {
    const ticket = await start();
    const res = await DELETE(
      new Request(ticket.endpoint, {
        method: 'DELETE',
        headers: new Headers({ authorization: `Bearer ${ticket.token}`, [SESSION_HEADER]: 'nope' }),
      }),
    );
    // Measured in production: this exact response, with a null body, hung.
    expect(res.status).toBe(404);
    expect(res.body).not.toBeNull();
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  /**
   * THE INVARIANT, over every kind of answer this route gives. A null body is
   * only ever sent with 204. Any other status with a null body is a request the
   * platform never answers, so a new code path that returns one fails here
   * rather than in a client three retries later.
   */
  it('never answers with a null body unless the status is 204', async () => {
    const ticket = await start();
    const session = await openSession(ticket);
    const auth = new Headers({ authorization: `Bearer ${ticket.token}` });
    const withSession = (id: string) =>
      new Headers({ authorization: `Bearer ${ticket.token}`, [SESSION_HEADER]: id });
    const list = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
    const note = { jsonrpc: '2.0', method: 'notifications/initialized' };
    const initialize = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'sweep', version: '1.0' } },
    };

    const answers: [string, Response][] = [
      ['initialize', await POST(mcpRequest(ticket, ticket.token, initialize))],
      ['notification', await POST(mcpRequest(ticket, ticket.token, note, session))],
      ['a second notification', await POST(mcpRequest(ticket, ticket.token, note, session))],
      ['tools/list', await POST(mcpRequest(ticket, ticket.token, list, session))],
      [
        'unknown method',
        await POST(
          mcpRequest(ticket, ticket.token, { jsonrpc: '2.0', id: 3, method: 'nope/nope' }, session),
        ),
      ],
      ['no session id', await POST(mcpRequest(ticket, ticket.token, list))],
      ['malformed session id', await POST(mcpRequest(ticket, ticket.token, list, 'nope'))],
      ['bad token', await POST(mcpRequest(ticket, `${ticket.token}x`, list, session))],
      ['no token', await POST(mcpRequest(ticket, null, list, session))],
      ['GET', await GET(new Request(ticket.endpoint, { method: 'GET', headers: auth }))],
      [
        'DELETE, malformed id',
        await DELETE(
          new Request(ticket.endpoint, { method: 'DELETE', headers: withSession('nope') }),
        ),
      ],
      [
        'DELETE, no session id',
        await DELETE(new Request(ticket.endpoint, { method: 'DELETE', headers: auth })),
      ],
      [
        'DELETE, live session',
        await DELETE(
          new Request(ticket.endpoint, { method: 'DELETE', headers: withSession(session) }),
        ),
      ],
    ];

    const bodiless = answers
      .filter(([, res]) => res.body === null && res.status !== 204)
      .map(([label, res]) => `${label} -> ${res.status}`);
    expect(bodiless).toEqual([]);
  });

  it('refuses a run id outside the grammar on every method, identically', async () => {
    const ticket = await start();
    const url = `${ORIGIN}/api/mcp/..%2Fetc`;
    const headers = new Headers({ authorization: `Bearer ${ticket.token}` });
    const get = await GET(new Request(url, { method: 'GET', headers }));
    const del = await DELETE(new Request(url, { method: 'DELETE', headers }));
    expect(get.status).toBe(401);
    expect(del.status).toBe(401);
    expect(await get.json()).toEqual({ error: RUN_TOKEN_REJECTION_MESSAGE });
    expect(await del.json()).toEqual({ error: RUN_TOKEN_REJECTION_MESSAGE });
  });
});
