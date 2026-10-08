import { McpTargetError } from './errors';
import { endpointLabel } from './endpoint';
import {
  classifyMessage,
  parseSseStream,
  JSONRPC_VERSION,
  MCP_PROTOCOL_VERSION,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcResponse,
} from './protocol';

/**
 * HTTP transports for MCP.
 *
 * PRIMARY — **Streamable HTTP** (MCP 2025-03-26 onward): one endpoint, JSON-RPC
 * over `POST`. The server answers either `application/json` (a single response)
 * or `text/event-stream` (the response plus any notifications it emitted while
 * working). Both are handled; the SSE answer is the graceful path for a server
 * that streams everything.
 *
 * FALLBACK — **legacy HTTP+SSE** (MCP 2024-11-05): a long-lived `GET` SSE stream
 * announces a separate message endpoint via an `endpoint` event; requests are
 * `POST`ed there and their responses arrive back on the GET stream. Entered only
 * when the Streamable `POST` is refused as unsupported (404/405/406), so a
 * server that speaks only the old transport still runs.
 *
 * Cross-cutting, on both: a per-request deadline, bounded retries with
 * exponential backoff, Zod validation of every inbound message, and typed
 * `McpTargetError`s. Nothing here ever puts the bearer credential in an error message.
 */

/** The subset of `fetch` this transport uses (injectable for tests). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface McpTransportOptions {
  /** Validated probe endpoint (see `ProbeEndpointSchema`). */
  endpoint: string;
  /** Bearer credential, sent as `Authorization: Bearer`. Never logged, never persisted. */
  apiKey?: string;
  /** Per-request deadline in ms (default 15000). */
  timeoutMs?: number;
  /** Total attempts per retryable request, including the first (default 3). */
  maxAttempts?: number;
  /** Backoff base in ms; attempt n waits `base * 2^(n-1)` (default 200). */
  baseDelayMs?: number;
  fetchImpl?: FetchLike;
  /** Injectable delay so backoff is instant and deterministic in tests. */
  sleep?: (ms: number) => Promise<void>;
  protocolVersion?: string;
}

/** A request's result plus any notifications the server emitted while serving it. */
export interface McpRequestOutcome {
  result: unknown;
  notifications: JsonRpcNotification[];
}

export interface McpRequestOptions {
  /**
   * Whether a transport fault may be retried. FALSE for `tools/call`: a tool
   * invocation is not guaranteed idempotent and a blind retry could execute the
   * target's side effect twice.
   */
  retryable?: boolean;
}

export interface McpSession {
  readonly transport: 'streamable-http' | 'sse';
  request(
    method: string,
    params?: unknown,
    options?: McpRequestOptions,
  ): Promise<McpRequestOutcome>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
}

const DEFAULTS = {
  timeoutMs: 15_000,
  maxAttempts: 3,
  baseDelayMs: 200,
} as const;

/** Statuses that mean "this server does not speak Streamable HTTP here". */
const LEGACY_SIGNAL_STATUSES = new Set([404, 405, 406]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolved options with defaults applied. */
interface Resolved extends Required<Omit<McpTransportOptions, 'apiKey'>> {
  apiKey?: string;
}

function resolveOptions(options: McpTransportOptions): Resolved {
  const resolved: Resolved = {
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
    maxAttempts: options.maxAttempts ?? DEFAULTS.maxAttempts,
    baseDelayMs: options.baseDelayMs ?? DEFAULTS.baseDelayMs,
    fetchImpl: options.fetchImpl ?? ((input, init) => fetch(input, init)),
    sleep: options.sleep ?? defaultSleep,
    protocolVersion: options.protocolVersion ?? MCP_PROTOCOL_VERSION,
  };
  if (options.apiKey !== undefined) resolved.apiKey = options.apiKey;
  return resolved;
}

/**
 * Run `fn` under a deadline. Implemented with an explicit `AbortController`
 * rather than `AbortSignal.timeout` so the timer is deterministic and the
 * transport does not depend on a host global that jsdom may not provide.
 */
async function withDeadline<T>(
  timeoutMs: number,
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (cause) {
    if (timedOut) {
      throw new McpTargetError('TIMEOUT', `${label} timed out after ${timeoutMs}ms.`, {
        cause,
        retryable: true,
      });
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

/** Retry a retryable transport fault with exponential backoff, bounded. */
async function withRetry<T>(o: Resolved, retryable: boolean, fn: () => Promise<T>): Promise<T> {
  const attempts = retryable ? o.maxAttempts : 1;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const fault = error instanceof McpTargetError && error.retryable;
      if (!fault || attempt === attempts) throw error;
      await o.sleep(o.baseDelayMs * 2 ** (attempt - 1));
    }
  }
  /* c8 ignore next -- unreachable: the loop either returns or throws. */
  throw last;
}

/** Wrap a raw fetch rejection as a typed, retryable connection failure. */
function connectionFailed(o: Resolved, cause: unknown): McpTargetError {
  return new McpTargetError(
    'CONNECTION_FAILED',
    `Could not reach the MCP endpoint at ${endpointLabel(o.endpoint)}.`,
    { cause, retryable: true },
  );
}

/** Non-2xx → a typed error; 429/5xx are marked retryable. */
function httpError(o: Resolved, status: number): McpTargetError {
  return new McpTargetError(
    'HTTP_ERROR',
    `The MCP endpoint at ${endpointLabel(o.endpoint)} answered HTTP ${status}.`,
    { status, retryable: status === 429 || status >= 500 },
  );
}

/** A JSON-RPC `error` object → a typed protocol error (message text is the server's). */
function protocolError(response: JsonRpcResponse): McpTargetError {
  const body = response.error;
  return new McpTargetError(
    'PROTOCOL_ERROR',
    `The MCP target rejected the request: ${body?.message ?? 'unknown error'} (code ${body?.code ?? 'none'}).`,
  );
}

function malformed(message: string, cause?: unknown): McpTargetError {
  return new McpTargetError('MALFORMED_RESPONSE', message, { cause });
}

/** Auth + protocol headers. The key is assembled here and nowhere else. */
function baseHeaders(o: Resolved, sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': o.protocolVersion,
  };
  if (o.apiKey) headers.authorization = `Bearer ${o.apiKey}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return headers;
}

// ── Streamable HTTP ──

class StreamableHttpSession implements McpSession {
  readonly transport = 'streamable-http' as const;
  private nextId = 1;
  private sessionId?: string;

  constructor(private readonly o: Resolved) {}

  async request(
    method: string,
    params?: unknown,
    options?: McpRequestOptions,
  ): Promise<McpRequestOutcome> {
    const id: JsonRpcId = this.nextId++;
    const body = JSON.stringify({
      jsonrpc: JSONRPC_VERSION,
      id,
      method,
      ...(params ? { params } : {}),
    });
    return withRetry(this.o, options?.retryable ?? true, () => this.exchange(method, id, body));
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const body = JSON.stringify({
      jsonrpc: JSONRPC_VERSION,
      method,
      ...(params ? { params } : {}),
    });
    const response = await this.post(method, body);
    if (!response.ok) throw httpError(this.o, response.status);
    await response.body?.cancel().catch(() => undefined);
  }

  async close(): Promise<void> {
    // Best effort: the spec's session teardown is a DELETE, and a server that
    // does not implement it must not fail the run.
    if (!this.sessionId) return;
    try {
      await withDeadline(this.o.timeoutMs, 'DELETE session', (signal) =>
        this.o.fetchImpl(this.o.endpoint, {
          method: 'DELETE',
          headers: baseHeaders(this.o, this.sessionId),
          signal,
        }),
      );
    } catch {
      // ignored on purpose
    }
  }

  private async post(label: string, body: string): Promise<Response> {
    return withDeadline(this.o.timeoutMs, `MCP ${label}`, async (signal) => {
      try {
        return await this.o.fetchImpl(this.o.endpoint, {
          method: 'POST',
          headers: baseHeaders(this.o, this.sessionId),
          body,
          signal,
        });
      } catch (cause) {
        if (signal.aborted) throw cause; // withDeadline converts this to TIMEOUT
        throw connectionFailed(this.o, cause);
      }
    });
  }

  private async exchange(method: string, id: JsonRpcId, body: string): Promise<McpRequestOutcome> {
    const response = await this.post(method, body);

    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;

    if (!response.ok) {
      const error = httpError(this.o, response.status);
      if (LEGACY_SIGNAL_STATUSES.has(response.status)) {
        throw new McpTargetError(
          'UNSUPPORTED_TRANSPORT',
          `The MCP endpoint at ${endpointLabel(this.o.endpoint)} refused a Streamable HTTP POST (HTTP ${response.status}).`,
          { status: response.status },
        );
      }
      throw error;
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/event-stream')) {
      return this.readSse(response, id);
    }
    if (contentType.includes('application/json') || contentType === '') {
      return this.readJson(response, id);
    }
    throw malformed(`The MCP target answered ${method} with an unusable content type.`);
  }

  private async readJson(response: Response, id: JsonRpcId): Promise<McpRequestOutcome> {
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (cause) {
      throw malformed('The MCP target did not return valid JSON.', cause);
    }
    const message = classifyMessage(parsed);
    if (message.kind !== 'response') {
      throw malformed('The MCP target did not return a JSON-RPC 2.0 response.');
    }
    if (message.message.id !== id) {
      throw malformed('The MCP target answered with a mismatched JSON-RPC id.');
    }
    if (message.message.error) throw protocolError(message.message);
    return { result: message.message.result, notifications: [] };
  }

  private async readSse(response: Response, id: JsonRpcId): Promise<McpRequestOutcome> {
    if (!response.body) throw malformed('The MCP target returned an empty event stream.');
    const notifications: JsonRpcNotification[] = [];
    for await (const frame of parseSseStream(response.body)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(frame.data);
      } catch {
        continue; // a keep-alive or non-JSON frame is not fatal
      }
      const message = classifyMessage(parsed);
      if (message.kind === 'notification') {
        notifications.push(message.message);
        continue;
      }
      if (message.kind === 'response' && message.message.id === id) {
        if (message.message.error) throw protocolError(message.message);
        return { result: message.message.result, notifications };
      }
    }
    throw malformed('The MCP target closed the event stream before answering.');
  }
}

// ── Legacy HTTP+SSE (MCP 2024-11-05) ──

interface Pending {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: unknown) => void;
}

class LegacySseSession implements McpSession {
  readonly transport = 'sse' as const;
  private readonly abort = new AbortController();
  private readonly pending = new Map<string, Pending>();
  private notifications: JsonRpcNotification[] = [];
  private nextId = 1;
  private messageUrl = '';
  private closed = false;

  constructor(private readonly o: Resolved) {}

  /** Open the GET stream and wait for the server's `endpoint` announcement. */
  async open(): Promise<void> {
    let response: Response;
    try {
      response = await withDeadline(this.o.timeoutMs, 'MCP SSE handshake', (signal) => {
        // The GET stream is long-lived, so it is aborted by `close()`, not by the
        // handshake deadline. The deadline still guards the connect itself.
        signal.addEventListener('abort', () => this.abort.abort(), { once: true });
        return this.o.fetchImpl(this.o.endpoint, {
          method: 'GET',
          headers: {
            accept: 'text/event-stream',
            'mcp-protocol-version': this.o.protocolVersion,
            ...(this.o.apiKey ? { authorization: `Bearer ${this.o.apiKey}` } : {}),
          },
          signal: this.abort.signal,
        });
      });
    } catch (cause) {
      if (cause instanceof McpTargetError) throw cause;
      throw connectionFailed(this.o, cause);
    }

    if (!response.ok) throw httpError(this.o, response.status);
    if (!response.body) throw malformed('The MCP target opened an empty SSE stream.');

    let announce: ((url: string) => void) | undefined;
    let fail: ((error: unknown) => void) | undefined;
    const announced = new Promise<string>((resolve, reject) => {
      announce = resolve;
      fail = reject;
    });
    // The pump owns the stream for the whole session; failures land on `announced`
    // first and on every pending request after that.
    void this.pump(response.body, (url) => announce?.(url)).catch((error) => {
      fail?.(error);
      this.failAll(error);
    });

    const url = await this.race(announced, 'SSE endpoint announcement');
    this.messageUrl = new URL(url, this.o.endpoint).href;
  }

  async request(
    method: string,
    params?: unknown,
    options?: McpRequestOptions,
  ): Promise<McpRequestOutcome> {
    return withRetry(this.o, options?.retryable ?? true, () => this.exchange(method, params));
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.postMessage(
      method,
      JSON.stringify({ jsonrpc: JSONRPC_VERSION, method, ...(params ? { params } : {}) }),
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    this.abort.abort();
    this.failAll(new McpTargetError('CONNECTION_FAILED', 'The MCP session was closed.'));
  }

  private async exchange(method: string, params?: unknown): Promise<McpRequestOutcome> {
    if (this.closed) throw new McpTargetError('CONNECTION_FAILED', 'The MCP session was closed.');
    const id = String(this.nextId++);
    const settled = new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    // Notifications are attributed to the request in flight; the adapter issues
    // one request at a time, so this window is unambiguous.
    this.notifications = [];

    try {
      await this.postMessage(
        method,
        JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, method, ...(params ? { params } : {}) }),
      );
      const response = await this.race(settled, `MCP ${method}`);
      if (response.error) throw protocolError(response);
      return { result: response.result, notifications: this.notifications };
    } finally {
      this.pending.delete(id);
      this.notifications = [];
    }
  }

  private async postMessage(label: string, body: string): Promise<void> {
    const response = await withDeadline(this.o.timeoutMs, `MCP ${label}`, async (signal) => {
      try {
        return await this.o.fetchImpl(this.messageUrl, {
          method: 'POST',
          headers: baseHeaders(this.o),
          body,
          signal,
        });
      } catch (cause) {
        if (signal.aborted) throw cause;
        throw connectionFailed(this.o, cause);
      }
    });
    if (!response.ok) throw httpError(this.o, response.status);
    await response.body?.cancel().catch(() => undefined);
  }

  /** Apply the per-request deadline to a promise settled by the SSE pump. */
  private race<T>(promise: Promise<T>, label: string): Promise<T> {
    return withDeadline(this.o.timeoutMs, label, (signal) =>
      Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
      ]),
    );
  }

  private async pump(
    body: ReadableStream<Uint8Array>,
    onEndpoint: (url: string) => void,
  ): Promise<void> {
    for await (const frame of parseSseStream(body)) {
      if (frame.event === 'endpoint') {
        onEndpoint(frame.data.trim());
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(frame.data);
      } catch {
        continue;
      }
      const message = classifyMessage(parsed);
      if (message.kind === 'notification') {
        this.notifications.push(message.message);
        continue;
      }
      if (message.kind === 'response') {
        this.pending.get(String(message.message.id))?.resolve(message.message);
      }
    }
  }

  private failAll(error: unknown): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

// ── Session opener ──

/**
 * Open an MCP session: Streamable HTTP first, degrading to the legacy HTTP+SSE
 * transport when the endpoint refuses a Streamable POST. Performs the MCP
 * handshake (`initialize` then the `notifications/initialized` notification) and
 * returns the live session.
 */
export async function openMcpSession(options: McpTransportOptions): Promise<McpSession> {
  const o = resolveOptions(options);
  const streamable = new StreamableHttpSession(o);
  try {
    await handshake(streamable, o);
    return streamable;
  } catch (error) {
    if (!(error instanceof McpTargetError) || error.code !== 'UNSUPPORTED_TRANSPORT') throw error;
  }

  const legacy = new LegacySseSession(o);
  try {
    await legacy.open();
    await handshake(legacy, o);
    return legacy;
  } catch (error) {
    await legacy.close();
    throw error;
  }
}

/** `initialize` + `notifications/initialized`, per the MCP lifecycle. */
async function handshake(session: McpSession, o: Resolved): Promise<void> {
  await session.request('initialize', {
    protocolVersion: o.protocolVersion,
    // We are an observer: we advertise no sampling/roots/elicitation, so the
    // target can never call back into us during a run.
    capabilities: {},
    // A neutral name: a product name would tell a probed server it is being tested.
    clientInfo: { name: 'mcp-client', version: '0.1.0' },
  });
  await session.notify('notifications/initialized');
}
