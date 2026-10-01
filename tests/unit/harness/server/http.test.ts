import {
  createStreamableHttpHandler,
  SESSION_HEADER,
  type StreamableHttpHandler,
} from '@/harness/server/http';
import { HostedMcpServer } from '@/harness/server/server';

const ENDPOINT = 'http://127.0.0.1/mcp';

function handler(): StreamableHttpHandler {
  return createStreamableHttpHandler(
    () => new HostedMcpServer({ category: 'ASI01', kind: 'malicious' }),
  );
}

interface PostOpts {
  sessionId?: string;
  accept?: string;
  contentType?: string;
  body?: string;
}

function post(h: StreamableHttpHandler, payload: unknown, opts: PostOpts = {}): Promise<Response> {
  const headers = new Headers({
    'content-type': opts.contentType ?? 'application/json',
    accept: opts.accept ?? 'application/json, text/event-stream',
  });
  if (opts.sessionId !== undefined) headers.set(SESSION_HEADER, opts.sessionId);
  return h.handle(
    new Request(ENDPOINT, {
      method: 'POST',
      headers,
      body: opts.body ?? JSON.stringify(payload),
    }),
  );
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', clientInfo: { name: 'agent', version: '1.0' } },
};

async function openSession(h: StreamableHttpHandler): Promise<string> {
  const res = await post(h, initialize);
  return res.headers.get(SESSION_HEADER)!;
}

describe('server/http Streamable HTTP: session lifecycle', () => {
  it('initialize mints a session id in the Mcp-Session-Id header and returns a JSON result', async () => {
    const h = handler();
    const res = await post(h, initialize);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const id = res.headers.get(SESSION_HEADER);
    expect(id).toBeTruthy();
    expect(h.sessionIds()).toContain(id);
    const body = await res.json();
    expect(body.result.protocolVersion).toBe('2025-06-18');
  });

  it('routes a later request to the session established by initialize', async () => {
    const h = handler();
    const id = await openSession(h);
    const res = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { sessionId: id });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.result.tools)).toBe(true);
  });

  it('records the agent tools/call into the session trace', async () => {
    const h = handler();
    const id = await openSession(h);
    await post(
      h,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'read_email', arguments: {} },
      },
      { sessionId: id },
    );
    const trace = await h.getSession(id)!.buildTrace();
    expect(trace.steps.some((s) => s.type === 'tool_call')).toBe(true);
  });

  it('acknowledges a notification with 202 and no body', async () => {
    const h = handler();
    const id = await openSession(h);
    const res = await post(
      h,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { sessionId: id },
    );
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });
});

describe('server/http: session guards', () => {
  it('rejects a non-initialize request with no session id (400)', async () => {
    const res = await post(handler(), { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/session/i);
  });

  it('rejects an unknown session id (404)', async () => {
    const res = await post(
      handler(),
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { sessionId: 'nope' },
    );
    expect(res.status).toBe(404);
  });

  it('stays strict by default even for a well-formed id it did not mint (404)', async () => {
    // The standalone loopback script builds its handler with no options, and it
    // must keep refusing a session it never opened.
    const res = await post(
      handler(),
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { sessionId: '3f0c9a1e-5b7d-4c21-9a55-0d8a6b1e2f73' },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toMatch(/unknown or expired session/i);
  });
});

/**
 * THE HOSTED PATH. One run, one server, and possibly many instances: a session
 * id minted by `initialize` on one instance arrives at another that has never
 * heard of it. The hosted pipeline has already matched the URL to a run and
 * verified the per-run token before this handler is reached, and there is one
 * server per run, so the session id carries no authority of its own. With
 * `adoptUnknownSessions` the handler binds such an id to the run's one server
 * instead of answering 404.
 */
describe('server/http: a session another instance opened (hosted path only)', () => {
  const ELSEWHERE = '3f0c9a1e-5b7d-4c21-9a55-0d8a6b1e2f73';

  function hosted(): { h: StreamableHttpHandler; server: HostedMcpServer } {
    const server = new HostedMcpServer({ category: 'ASI01', kind: 'malicious' });
    const h = createStreamableHttpHandler(() => server, { adoptUnknownSessions: true });
    return { h, server };
  }

  it('acknowledges a notification on a session id it did not mint', async () => {
    const { h } = hosted();
    const res = await post(
      h,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { sessionId: ELSEWHERE },
    );
    expect(res.status).toBe(202);
  });

  it('answers a request on a session id it did not mint', async () => {
    const { h } = hosted();
    const res = await post(
      h,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { sessionId: ELSEWHERE },
    );
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).result.tools)).toBe(true);
  });

  it('binds the adopted session to the run one server, so it is one trace', async () => {
    const { h, server } = hosted();
    await post(
      h,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'read_email', arguments: {} },
      },
      { sessionId: ELSEWHERE },
    );
    expect(h.getSession(ELSEWHERE)).toBe(server);
    const trace = await server.buildTrace();
    expect(trace.steps.some((s) => s.type === 'tool_call')).toBe(true);
  });

  it('still requires a session id: no header is a 400, exactly as before', async () => {
    const { h } = hosted();
    const res = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(400);
  });

  it('still refuses an id that is not shaped like one we mint (404)', async () => {
    const { h } = hosted();
    for (const sessionId of ['nope', 'x'.repeat(4000), '../../etc/passwd', '']) {
      const res = await post(h, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { sessionId });
      // An empty header reads as absent (400); every other malformed id is 404.
      expect([400, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);
    }
    expect(h.sessionIds()).toEqual([]);
  });

  it('bounds how many session ids one run can make an instance remember', async () => {
    const { h } = hosted();
    for (let i = 0; i < 200; i += 1) {
      const sessionId = `3f0c9a1e-5b7d-4c21-9a55-${String(i).padStart(12, '0')}`;
      await post(h, { jsonrpc: '2.0', id: i, method: 'tools/list' }, { sessionId });
    }
    // A caller holding a valid token must not be able to grow the map without
    // limit by inventing ids.
    expect(h.sessionIds().length).toBeLessThanOrEqual(64);
  });

  it('answers DELETE for a session it never saw with 204, since ending is idempotent', async () => {
    const { h } = hosted();
    const res = await h.handle(
      new Request(ENDPOINT, { method: 'DELETE', headers: { [SESSION_HEADER]: ELSEWHERE } }),
    );
    // The client closes against whichever instance answers. A 404 there would
    // make a clean shutdown look like an error.
    expect(res.status).toBe(204);
  });
});

describe('server/http: content negotiation', () => {
  it('rejects a non-JSON content type with 415', async () => {
    const res = await post(handler(), initialize, { contentType: 'text/plain' });
    expect(res.status).toBe(415);
  });

  it('rejects an Accept that allows neither JSON nor SSE with 406', async () => {
    const res = await post(handler(), initialize, { accept: 'text/html' });
    expect(res.status).toBe(406);
  });

  it('returns a single SSE frame when the client accepts only text/event-stream', async () => {
    const res = await post(handler(), initialize, { accept: 'text/event-stream' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toMatch(/^event: message\ndata: /);
    expect(text).toContain('"protocolVersion"');
  });

  it('rejects a malformed JSON body with a JSON-RPC parse error (400)', async () => {
    const res = await post(handler(), null, { body: '{ not json' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32700);
  });
});

describe('server/http: GET and DELETE', () => {
  it('answers GET with 405 (no server-initiated stream)', async () => {
    const res = await handler().handle(new Request(ENDPOINT, { method: 'GET' }));
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('POST');
  });

  it('answers an unsupported method with 405', async () => {
    const res = await handler().handle(new Request(ENDPOINT, { method: 'PUT' }));
    expect(res.status).toBe(405);
  });

  it('DELETE ends a live session (204) and 404s an unknown one', async () => {
    const h = handler();
    const id = await openSession(h);
    const ok = await h.handle(
      new Request(ENDPOINT, { method: 'DELETE', headers: { [SESSION_HEADER]: id } }),
    );
    expect(ok.status).toBe(204);
    expect(h.getSession(id)).toBeUndefined();
    const gone = await h.handle(
      new Request(ENDPOINT, { method: 'DELETE', headers: { [SESSION_HEADER]: id } }),
    );
    expect(gone.status).toBe(404);
  });

  it('DELETE with no session id is a 400', async () => {
    const res = await handler().handle(new Request(ENDPOINT, { method: 'DELETE' }));
    expect(res.status).toBe(400);
  });

  it('endSession reports whether the session existed', async () => {
    const h = handler();
    const id = await openSession(h);
    expect(h.endSession(id)).toBe(true);
    expect(h.endSession(id)).toBe(false);
  });
});

/**
 * NO NULL BODY BUT 204, on the hosted path. Measured against the deployed
 * endpoint on 2026-10-01: a response from the hosted route with a null body and
 * any status other than 204 has its headers sent and its body never terminated,
 * so it never completes. The MCP acknowledgement of a notification is `202` with
 * no body, so a client that waits for that response to finish stalls on its
 * second request. With `neverBodiless` the handler gives those answers a body;
 * without it the transport stays exactly as the spec words it.
 */
describe('server/http: no null body but 204 (hosted path only)', () => {
  const ELSEWHERE = '3f0c9a1e-5b7d-4c21-9a55-0d8a6b1e2f73';
  const note = { jsonrpc: '2.0', method: 'notifications/initialized' };

  function hosted(): StreamableHttpHandler {
    const server = new HostedMcpServer({ category: 'ASI01', kind: 'malicious' });
    return createStreamableHttpHandler(() => server, {
      adoptUnknownSessions: true,
      neverBodiless: true,
    });
  }

  it('acknowledges a notification with 202 and a body', async () => {
    const res = await post(hosted(), note, { sessionId: ELSEWHERE });
    expect(res.status).toBe(202);
    expect(res.body).not.toBeNull();
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  it('gives the acknowledgement a body no client could mistake for a JSON-RPC message', async () => {
    const res = await post(hosted(), note, { sessionId: ELSEWHERE });
    // Not JSON and not an event stream: a client that parses those has nothing
    // here to parse, and one that follows the spec ignores a 202 body anyway.
    const type = res.headers.get('content-type') ?? '';
    expect(type).toContain('text/plain');
    expect(type).not.toContain('json');
    expect(type).not.toContain('event-stream');
  });

  it('answers DELETE for a malformed session id with a 404 that carries a body', async () => {
    const res = await hosted().handle(
      new Request(ENDPOINT, { method: 'DELETE', headers: { [SESSION_HEADER]: 'nope' } }),
    );
    expect(res.status).toBe(404);
    expect(res.body).not.toBeNull();
    expect((await res.json()).error.message).toMatch(/unknown or expired session/i);
  });

  it('still answers a real session end with a bare 204', async () => {
    const h = hosted();
    const id = await openSession(h);
    const res = await h.handle(
      new Request(ENDPOINT, { method: 'DELETE', headers: { [SESSION_HEADER]: id } }),
    );
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it('leaves the default transport exactly as the spec words it: 202 with no body', async () => {
    const h = handler();
    const id = await openSession(h);
    const res = await post(h, note, { sessionId: id });
    expect(res.status).toBe(202);
    expect(res.body).toBeNull();
  });
});
