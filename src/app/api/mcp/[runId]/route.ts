/**
 * THE HOSTED MCP ENDPOINT — `/api/mcp/<runId>`.
 *
 * Under [ADR-0006](../../../../../docs/adr/0006-mcpwn-is-the-mcp-server.md) MCProof
 * IS the MCP server and the user's agent connects to US. This route is that door.
 * It mounts the run's `handle()` (`src/runs/live-run.ts`), which authenticates the
 * inbound connection against the per-run token and then serves the Streamable
 * HTTP surface the harness already implements: session header, `Accept`
 * negotiation, JSON or one SSE frame, `202` for a lone notification, `405` for a
 * method that carries nothing.
 *
 * ── THIS IS INBOUND ATTACK SURFACE, DELIBERATELY ──
 *
 * We invite a stranger's agent to connect and the tools we serve are hostile by
 * construction. There is nothing real behind this endpoint — no account, no
 * money, no data but fabricated attack content — and it is still treated as
 * hostile in both directions:
 *
 *  - EVERY inbound field is untrusted. The run id is read off the path and put
 *    through a Zod grammar before it is used as a key; the body is bounded before
 *    it is read; the JSON-RPC payload is validated by the surface itself and can
 *    only become a typed error envelope, never a stack trace.
 *  - EVERY refusal is ONE refusal. A missing token, a malformed token, another
 *    run's token, an expired token, a finished run, an unknown run and a run id
 *    outside the grammar all get the same 401 and the same sentence. Telling them
 *    apart is exactly the oracle that lets someone enumerate which runs exist, so
 *    this route adds no code of its own to the ones the token module defines.
 *  - NOTHING SECRET IS LOGGED. The bearer credential is read by
 *    `verifyRunToken` and never touched here; the only thing this route records
 *    is that an authenticated request arrived for a run.
 *
 * ── WHY THE BODY IS BOUNDED HERE AND NOT IN THE TRANSPORT ──
 *
 * `createStreamableHttpHandler` calls `request.json()`, which will happily buffer
 * whatever a stranger sends. The cap belongs at the edge, before authentication,
 * because refusing a 50MB body must not first cost a database read. A bounded
 * body is re-issued as a fresh `Request` so the transport still sees exactly what
 * it expects.
 */
import { z } from 'zod';
import { RPC_INVALID_REQUEST, jsonRpcError } from '@/harness/server/protocol';
import { RUN_TOKEN_REJECTION_MESSAGE } from '@/runs/run-token';
import { getLiveRunHost, noteAgentRequest } from '@/app/api/mcp/host';

/** `node:crypto` verifies the token, so this route runs on Node, not the Edge. */
export const runtime = 'nodejs';
/** A run endpoint answers for the run happening right now. Never cached. */
export const dynamic = 'force-dynamic';

/**
 * The largest JSON-RPC body this endpoint will read, in bytes.
 *
 * Generous for the surface it serves — the biggest honest message is a
 * `tools/call` carrying an agent's arguments — and small enough that an
 * unauthenticated stranger cannot spend our memory by sending a stream.
 */
export const MAX_MCP_BODY_BYTES = 64 * 1024;

/**
 * The run id, as it appears in the path.
 *
 * Read from the URL rather than from the route params so that this route and
 * `handle()` (which parses the same path) cannot disagree about which run was
 * addressed. The grammar is deliberately narrow: ids we mint are UUIDs, and
 * anything carrying a slash, a percent escape or a space is not one.
 */
const RunIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/);

/** The ONE refusal, identical to the pipeline's own. */
function unauthorized(): Response {
  return new Response(JSON.stringify({ error: RUN_TOKEN_REJECTION_MESSAGE }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
  });
}

/** The body was over the cap. Answered in the protocol the caller is speaking. */
function tooLarge(): Response {
  return new Response(
    JSON.stringify(jsonRpcError(null, RPC_INVALID_REQUEST, 'Request body is too large.')),
    { status: 413, headers: { 'content-type': 'application/json' } },
  );
}

/** The addressed run, or `null` when the path does not name one. */
function runIdOf(request: Request): string | null {
  const segments = new URL(request.url).pathname.split('/').filter((s) => s.length > 0);
  const result = RunIdSchema.safeParse(segments[segments.length - 1] ?? '');
  return result.success ? result.data : null;
}

/**
 * Serve one request and, if it authenticated, note that the agent is here.
 *
 * A 401 is never noted: an unauthenticated stranger must not be able to make a
 * run look connected on the owner's screen.
 */
async function serve(request: Request, runId: string): Promise<Response> {
  const response = await getLiveRunHost().handle(request);
  if (response.status !== 401) noteAgentRequest(runId);
  return response;
}

/** The agent speaks JSON-RPC over POST. Everything a run does arrives here. */
export async function POST(request: Request): Promise<Response> {
  const runId = runIdOf(request);
  if (runId === null) return unauthorized();

  // Cheapest refusal first, and before authentication: a body we will not read is
  // refused without a store read, a digest or a session lookup.
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_MCP_BODY_BYTES) return tooLarge();

  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_MCP_BODY_BYTES) return tooLarge();

  // The body was consumed to measure it, so the transport is handed a fresh
  // request carrying the same method, URL, headers and bytes. `content-length` is
  // dropped because the runtime sets it from the body it is given.
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  return serve(new Request(request.url, { method: 'POST', headers, body }), runId);
}

/**
 * GET opens a server-initiated stream in Streamable HTTP. We serve none, so the
 * transport answers 405 — but only for a caller who authenticated first, so the
 * method surface is not readable by a stranger.
 */
export async function GET(request: Request): Promise<Response> {
  const runId = runIdOf(request);
  if (runId === null) return unauthorized();
  return serve(request, runId);
}

/** DELETE terminates an MCP session. The run itself ends through `finish()`. */
export async function DELETE(request: Request): Promise<Response> {
  const runId = runIdOf(request);
  if (runId === null) return unauthorized();
  return serve(request, runId);
}
