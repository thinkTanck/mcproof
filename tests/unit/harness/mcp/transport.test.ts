import { openMcpSession, type FetchLike } from '@/harness/mcp';
import { findTells } from '@/harness/server/surface';
import { streamableFetch } from './fake-server';

/**
 * Transport-level behaviour of the HTTP MCP adapter: bounded retries with
 * backoff, the per-request deadline, and the deliberate NON-retry of
 * `tools/call` (a tool invocation is not guaranteed idempotent, so replaying it
 * could fire the target's side effect twice).
 */

const base = {
  endpoint: 'https://agent.example/mcp',
  baseDelayMs: 1,
  sleep: async () => undefined,
};

describe('openMcpSession · retries', () => {
  it('retries a 503 with backoff up to maxAttempts, then succeeds', async () => {
    const server = streamableFetch();
    let failures = 2;
    const delays: number[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      if (failures > 0) {
        failures -= 1;
        return new Response('busy', { status: 503 });
      }
      return server.fetch(url, init);
    };

    const session = await openMcpSession({
      ...base,
      fetchImpl,
      maxAttempts: 3,
      baseDelayMs: 10,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    expect(session.transport).toBe('streamable-http');
    expect(delays).toEqual([10, 20]); // exponential, bounded
  });

  it('gives up with the typed HTTP_ERROR once maxAttempts is exhausted', async () => {
    let attempts = 0;
    const fetchImpl: FetchLike = async () => {
      attempts += 1;
      return new Response('busy', { status: 503 });
    };
    await expect(openMcpSession({ ...base, fetchImpl, maxAttempts: 2 })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 503,
    });
    expect(attempts).toBe(2);
  });

  it('does not retry a 400 (not a transport fault)', async () => {
    let attempts = 0;
    const fetchImpl: FetchLike = async () => {
      attempts += 1;
      return new Response('bad', { status: 400 });
    };
    await expect(openMcpSession({ ...base, fetchImpl, maxAttempts: 3 })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
    });
    expect(attempts).toBe(1);
  });

  it('retries a connection failure and reports CONNECTION_FAILED when it persists', async () => {
    let attempts = 0;
    const fetchImpl: FetchLike = async () => {
      attempts += 1;
      throw new TypeError('fetch failed');
    };
    await expect(openMcpSession({ ...base, fetchImpl, maxAttempts: 3 })).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });
    expect(attempts).toBe(3);
  });

  it('does NOT retry a tools/call, so a non-idempotent tool never fires twice', async () => {
    const server = streamableFetch();
    let toolCalls = 0;
    const fetchImpl: FetchLike = async (url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (body?.method === 'tools/call') {
        toolCalls += 1;
        return new Response('busy', { status: 503 });
      }
      return server.fetch(url, init);
    };
    const session = await openMcpSession({ ...base, fetchImpl, maxAttempts: 3 });
    await expect(
      session.request('tools/call', { name: 'agent' }, { retryable: false }),
    ).rejects.toMatchObject({ code: 'HTTP_ERROR' });
    expect(toolCalls).toBe(1);
  });
});

describe('openMcpSession · deadline', () => {
  it('aborts a hung request with the typed TIMEOUT', async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    await expect(
      openMcpSession({ ...base, fetchImpl, timeoutMs: 5, maxAttempts: 1 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('openMcpSession · transport negotiation', () => {
  it('surfaces UNSUPPORTED_TRANSPORT when neither transport is available', async () => {
    const fetchImpl: FetchLike = async (_url, init) =>
      init?.method === 'POST'
        ? new Response('no', { status: 405 })
        : new Response('no', { status: 404 });
    await expect(openMcpSession({ ...base, fetchImpl, maxAttempts: 1 })).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 404,
    });
  });
});

describe('openMcpSession · what a probed server is told about us', () => {
  it('introduces itself with a neutral client name, never a product name', async () => {
    const server = streamableFetch();

    await openMcpSession({ ...base, fetchImpl: server.fetch });

    const init = server.calls.find(
      (c) => (c.body as { method?: string } | undefined)?.method === 'initialize',
    );
    const clientInfo = (init?.body as { params: { clientInfo: { name: string } } }).params
      .clientInfo;
    expect(clientInfo.name).toBe('mcp-client');
    expect(findTells(JSON.stringify(init?.body))).toEqual([]);
  });
});
