/**
 * HOSTED MCP SERVER — Streamable HTTP transport (MCP spec revision 2025-06-18).
 *
 * This is the productization step the stdio spikes explicitly did NOT take: the
 * spikes used stdio because TLS, a per-run endpoint and a token bear nothing on
 * the behavioural "does it bite" question. A HOSTED red-team run needs the real
 * transport, so this implements Streamable HTTP against the current spec:
 *
 *  - **Single endpoint, POST + GET + DELETE.** The client POSTs JSON-RPC; a GET
 *    would open a server->client SSE stream (we serve none, so GET is 405); a
 *    DELETE terminates the session.
 *  - **`Accept` negotiation.** A POST carrying a request must accept
 *    `application/json` and/or `text/event-stream`. We answer a single response
 *    as JSON by default, or as one SSE frame when the client accepts only SSE.
 *  - **Session handling.** `initialize` mints a session and returns it in the
 *    `Mcp-Session-Id` response header; every later request MUST carry it. A
 *    missing id is 400, an unknown/expired id is 404 (spec). That strict form is
 *    the DEFAULT. The hosted pipeline opts into `adoptUnknownSessions`, because
 *    there the session map is one serverless instance's memory and the id an
 *    agent carries may have been minted by another instance: see the option.
 *  - **JSON-RPC-only bodies with a request that has no response owed** (a lone
 *    notification such as `notifications/initialized`) get `202 Accepted`, no body.
 *
 * Every inbound payload is JSON-parsed and Zod-validated before any field is read
 * (the dispatch happens in `HostedMcpServer.handle`, which never throws), so
 * malformed input becomes a proper JSON-RPC error with the right HTTP status, not
 * a crash. Framework-agnostic: it operates on Web `Request` / `Response`, so it
 * mounts as a Next route handler or runs behind the Node wrapper in `node.ts`.
 */
import { JSONRPC_VERSION } from '@/harness/mcp/protocol';
import {
  RPC_INVALID_REQUEST,
  RPC_PARSE_ERROR,
  classifyInbound,
  jsonRpcError,
  type JsonRpcOutbound,
} from '@/harness/server/protocol';
import type { HostedMcpServer } from '@/harness/server/server';

/** The MCP session header (spec: case-insensitive; we read/write this casing). */
export const SESSION_HEADER = 'mcp-session-id';
/** The MCP protocol-version header a client SHOULD send after initialize. */
export const PROTOCOL_HEADER = 'mcp-protocol-version';

const JSON_MIME = 'application/json';
const SSE_MIME = 'text/event-stream';

/** How a new session's server is created — one server (one surface) per run. */
export type ServerFactory = () => HostedMcpServer;

export interface StreamableHttpHandler {
  /** Handle one HTTP request against the session registry. */
  handle(request: Request): Promise<Response>;
  /** The server bound to a live session, or undefined. */
  getSession(id: string): HostedMcpServer | undefined;
  /** Live session ids, in creation order. */
  sessionIds(): string[];
  /** Drop a session (as a client DELETE does), returning whether it existed. */
  endSession(id: string): boolean;
}

export interface StreamableHttpOptions {
  /**
   * Bind a session id this handler did not mint to its server, instead of
   * answering 404. OFF by default.
   *
   * WHY IT EXISTS. The session map below is process memory. On a serverless
   * platform nothing pins an agent's second request to the instance that served
   * its `initialize`, and an instance that rebuilds a run from the durable row
   * starts with an empty map. Strict handling there answers 404 "Unknown or
   * expired session" to a session another instance opened. The run is durable;
   * the session is not.
   *
   * A CORRECTION KEPT ON RECORD. This option shipped on 2026-10-01 as the fix
   * for a production failure in which Claude Code initialized and then failed.
   * That diagnosis was wrong. It was reasoned from the code and a simulation and
   * never checked against the deployed endpoint, where the session carried fine
   * and the real cause was `neverBodiless`, below. The defect this option closes
   * is real and is reproduced by a test, but it was not what broke production.
   *
   * WHY IT IS SAFE WHERE IT IS ENABLED, AND ONLY THERE. The hosted pipeline
   * (`src/runs/live-run.ts`) reaches this handler only after it has matched the
   * URL to one run and verified that run's bearer token, on every request, and
   * it builds one server per run. So in that path the session id selects nothing
   * and authorizes nothing: there is exactly one server it could mean. A caller
   * who mounts this handler WITHOUT that authentication in front (the loopback
   * script does) must leave this off, or any id would open the server.
   *
   * Two guards stay on regardless: only an id shaped like the ones we mint is
   * adopted, and the map is bounded, so a token holder cannot grow it without
   * limit by inventing ids.
   */
  readonly adoptUnknownSessions?: boolean;

  /**
   * Never answer with a null body unless the status is 204. OFF by default.
   *
   * WHAT WAS MEASURED (deployed endpoint, 2026-10-01). On the platform the
   * hosted route runs on, a response from that route with a NULL body and a
   * status other than 204 has its headers sent, with chunked transfer encoding,
   * and its body NEVER TERMINATED. The status line arrives in about 250 ms and
   * the response then never completes. Controlled on one route and one status:
   * a 404 with a JSON body completed in 614 ms; the same 404 with a null body
   * never completed. A 204 with a null body completed normally. The same code
   * completes every one of these instantly under `next start`, so nothing
   * local and nothing in CI showed it.
   *
   * WHY IT MATTERED. The spec's acknowledgement of a notification is exactly
   * that shape: `202 Accepted` with no body. `notifications/initialized` is the
   * second request every real client sends. A client that waits for the
   * response to finish never gets past it: Claude Code 2.1.287 logged
   * CONNECT_TIMEOUT after 30 s, three times, and reported the server as failed.
   * A client that discards a 202 body without waiting is unaffected, which is
   * why the bare MCP SDK client connected to the same deployment and why this
   * was hard to see. Both were reproduced against a local stand-in that does
   * to a response what production was measured doing: old transport, timeout;
   * this option on, "Successfully connected" in 279 ms.
   *
   * WHAT IT CHANGES. The two null-body answers this handler can give outside
   * 204 get a body: the 202 acknowledgement carries a short plain-text body,
   * and a DELETE for an unknown session carries the JSON-RPC error its POST
   * twin already does. The 202 body is a deliberate departure from the letter
   * of the spec ("with no body") for the hosted path only. It is `text/plain`,
   * so a client that parses JSON or an event stream has nothing to parse, and
   * clients that follow the spec discard a 202 body unread. The default
   * transport is untouched and stays bodiless, as the spec words it.
   *
   * The cause inside the platform is not established: only the behaviour is.
   */
  readonly neverBodiless?: boolean;
}

/** What the hosted path sends as the body of a 202 acknowledgement. */
export const ACKNOWLEDGEMENT_BODY = 'Accepted';

/** The most session ids one handler will remember. Oldest goes first. */
export const MAX_SESSIONS_PER_HANDLER = 64;

/** The shape of an id `newSessionId` mints: a canonical UUID. */
const MINTED_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mint a session id. Opaque and unguessable — never encodes anything about the run. */
function newSessionId(): string {
  return globalThis.crypto.randomUUID();
}

/** Parse an HTTP `Accept` header into the media types the client will take. */
function accepts(request: Request): { json: boolean; sse: boolean } {
  const header = request.headers.get('accept') ?? '';
  const lowered = header.toLowerCase();
  const any = lowered.includes('*/*') || header.trim() === '';
  return {
    json: any || lowered.includes(JSON_MIME),
    sse: any || lowered.includes(SSE_MIME),
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': JSON_MIME, ...headers },
  });
}

/** One SSE frame carrying a single JSON-RPC message, then the stream closes. */
function sseResponse(message: JsonRpcOutbound, headers: Record<string, string> = {}): Response {
  const body = `event: message\ndata: ${JSON.stringify(message)}\n\n`;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': SSE_MIME,
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      ...headers,
    },
  });
}

/** Render one JSON-RPC response as either JSON or a single SSE frame. */
function renderOutbound(
  message: JsonRpcOutbound,
  want: { json: boolean; sse: boolean },
  headers: Record<string, string>,
): Response {
  if (want.json) return jsonResponse(message, 200, headers);
  return sseResponse(message, headers);
}

/**
 * Build a Streamable-HTTP handler over a session registry. `newServer` creates a
 * fresh `HostedMcpServer` — one surface, one run — for each `initialize`.
 */
export function createStreamableHttpHandler(
  newServer: ServerFactory,
  options: StreamableHttpOptions = {},
): StreamableHttpHandler {
  const sessions = new Map<string, HostedMcpServer>();
  const adopt = options.adoptUnknownSessions === true;
  const bodied = options.neverBodiless === true;

  /** Remember a session, evicting the oldest once the map is full. */
  function remember(id: string, server: HostedMcpServer): void {
    if (!sessions.has(id) && sessions.size >= MAX_SESSIONS_PER_HANDLER) {
      const oldest = sessions.keys().next().value;
      if (oldest !== undefined) sessions.delete(oldest);
    }
    sessions.set(id, server);
  }

  /**
   * The server for a presented session id. A known id is served as always. An
   * unknown one is adopted only when the caller opted in and the id is shaped
   * like one we mint; otherwise it stays unknown and the caller answers 404.
   */
  function serverFor(id: string): HostedMcpServer | undefined {
    const known = sessions.get(id);
    if (known !== undefined) return known;
    if (!adopt || !MINTED_SESSION_ID.test(id)) return undefined;
    const server = newServer();
    remember(id, server);
    return server;
  }

  async function handlePost(request: Request): Promise<Response> {
    const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes(JSON_MIME)) {
      return jsonResponse(
        jsonRpcError(null, RPC_INVALID_REQUEST, 'Content-Type must be application/json.'),
        415,
      );
    }
    const want = accepts(request);
    if (!want.json && !want.sse) {
      return jsonResponse(
        jsonRpcError(
          null,
          RPC_INVALID_REQUEST,
          'Accept must allow application/json or text/event-stream.',
        ),
        406,
      );
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonResponse(jsonRpcError(null, RPC_PARSE_ERROR, 'Parse error'), 400);
    }

    const inbound = classifyInbound(raw);
    const sessionId = request.headers.get(SESSION_HEADER) ?? undefined;
    const isInitialize = inbound.kind === 'request' && inbound.message.method === 'initialize';

    // A brand-new session is minted by `initialize` and by nothing else.
    if (isInitialize) {
      const id = newSessionId();
      const server = newServer();
      remember(id, server);
      const response = server.handle(raw);
      // initialize always owes a response.
      return renderOutbound(
        response ?? jsonRpcError(null, RPC_INVALID_REQUEST, 'no response'),
        want,
        {
          [SESSION_HEADER]: id,
        },
      );
    }

    // Every other message must ride an established session.
    if (sessionId === undefined) {
      return jsonResponse(
        jsonRpcError(
          inbound.kind === 'request' ? inbound.message.id : null,
          RPC_INVALID_REQUEST,
          'Missing Mcp-Session-Id. Send initialize first.',
        ),
        400,
      );
    }
    const server = serverFor(sessionId);
    if (server === undefined) {
      return jsonResponse(
        jsonRpcError(
          inbound.kind === 'request' ? inbound.message.id : null,
          RPC_INVALID_REQUEST,
          'Unknown or expired session.',
        ),
        404,
      );
    }

    const response = server.handle(raw);
    // A notification (or any message owing no response) is acknowledged with 202.
    if (response === null) return acknowledged();
    return renderOutbound(response, want, {});
  }

  /**
   * The 202 acknowledgement. Bodiless by default, exactly as the spec words it;
   * with `neverBodiless` it carries a short plain-text body, because on the
   * hosted platform a null-body 202 never completes (see the option).
   */
  function acknowledged(): Response {
    if (!bodied) return new Response(null, { status: 202 });
    return new Response(ACKNOWLEDGEMENT_BODY, {
      status: 202,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  function handleDelete(request: Request): Response {
    const sessionId = request.headers.get(SESSION_HEADER) ?? undefined;
    if (sessionId === undefined) {
      return jsonResponse(jsonRpcError(null, RPC_INVALID_REQUEST, 'Missing Mcp-Session-Id.'), 400);
    }
    const existed = sessions.delete(sessionId);
    // Ending is idempotent across instances: with adoption on, a session this
    // instance never saw was opened by another one, and the client closing it
    // here has closed it. The strict path still reports an unknown id as 404.
    const ended = existed || (adopt && MINTED_SESSION_ID.test(sessionId));
    if (ended) return new Response(null, { status: 204 });
    // An unknown session. Bodiless by default; with `neverBodiless` it says so
    // in the same JSON-RPC error a POST on an unknown session already returns.
    if (!bodied) return new Response(null, { status: 404 });
    return jsonResponse(
      jsonRpcError(null, RPC_INVALID_REQUEST, 'Unknown or expired session.'),
      404,
    );
  }

  return {
    async handle(request: Request): Promise<Response> {
      switch (request.method) {
        case 'POST':
          return handlePost(request);
        case 'GET':
          // We serve no server-initiated stream, so there is nothing to open.
          return new Response('Method Not Allowed', {
            status: 405,
            headers: { allow: 'POST, DELETE' },
          });
        case 'DELETE':
          return handleDelete(request);
        default:
          return new Response('Method Not Allowed', {
            status: 405,
            headers: { allow: 'POST, DELETE' },
          });
      }
    },
    getSession(id) {
      return sessions.get(id);
    },
    sessionIds() {
      return [...sessions.keys()];
    },
    endSession(id) {
      return sessions.delete(id);
    },
  };
}

export { JSONRPC_VERSION };
