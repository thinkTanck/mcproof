/**
 * HOSTED MCP SERVER — inbound (SERVER-side) JSON-RPC surface.
 *
 * The mirror image of `src/harness/mcp/protocol.ts`. That module is a CLIENT: it
 * validates the *results* a remote server sends back. Here MCProof is the server
 * ([ADR-0006](../../../docs/adr/0006-mcpwn-is-the-mcp-server.md)), so we validate
 * the *requests* an agent sends us and PRODUCE results. The envelope constants
 * and the Zod discipline are reused from that client layer; the request-handling
 * half is what is new (the client never had to read a request).
 *
 * HOSTILE SURFACE. We deliberately invite an agent we do not control to speak to
 * this endpoint, so every inbound message is Zod-validated before any field is
 * read (CLAUDE.md: Zod on all external input), and every failure becomes a TYPED
 * `ServerProtocolError` the dispatcher turns into a JSON-RPC error response.
 * Nothing here throws raw.
 *
 * Schemas are LOOSE on purpose (same rationale as the client layer): real MCP
 * clients legitimately add fields such as `_meta`, and an unknown extra key must
 * not fail a handshake.
 *
 * This is the productization of the ASI01 / ASI04 stdio spikes' `protocol.ts`,
 * widened to the two prompt methods that deliver the task goal out of band.
 */
import { z } from 'zod';
import { JsonValueSchema, type JsonValue } from '@/contract';
import { JSONRPC_VERSION, JsonRpcIdSchema, type JsonRpcId } from '@/harness/mcp/protocol';

/** Standard JSON-RPC 2.0 error codes — the only ones this endpoint answers with. */
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;

/** Typed failure codes, mapped 1:1 onto the JSON-RPC codes above. */
export type ServerErrorCode =
  /** The payload was not parseable JSON. */
  | 'PARSE_ERROR'
  /** The message was not a JSON-RPC 2.0 request or notification. */
  | 'INVALID_REQUEST'
  /** A method outside the served surface. */
  | 'METHOD_NOT_FOUND'
  /** The method is served, but its params failed validation. */
  | 'INVALID_PARAMS';

const RPC_CODES: Record<ServerErrorCode, number> = {
  PARSE_ERROR: RPC_PARSE_ERROR,
  INVALID_REQUEST: RPC_INVALID_REQUEST,
  METHOD_NOT_FOUND: RPC_METHOD_NOT_FOUND,
  INVALID_PARAMS: RPC_INVALID_PARAMS,
};

/** A typed protocol failure. Never escapes the dispatcher — it becomes a response. */
export class ServerProtocolError extends Error {
  readonly code: ServerErrorCode;
  readonly rpcCode: number;

  constructor(code: ServerErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ServerProtocolError';
    this.code = code;
    this.rpcCode = RPC_CODES[code];
  }
}

// ── inbound envelopes ──

export const InboundRequestSchema = z.looseObject({
  jsonrpc: z.literal(JSONRPC_VERSION),
  id: JsonRpcIdSchema,
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type InboundRequest = z.infer<typeof InboundRequestSchema>;

export const InboundNotificationSchema = z.looseObject({
  jsonrpc: z.literal(JSONRPC_VERSION),
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type InboundNotification = z.infer<typeof InboundNotificationSchema>;

/** A JSON-RPC error body, as it rides inside a response envelope. */
export interface JsonRpcErrorBody {
  code: number;
  message: string;
}

/**
 * One classified inbound message. `invalid` carries the id when we could still
 * recover one, so a client can correlate the error with its request.
 */
export type InboundMessage =
  | { kind: 'request'; message: InboundRequest }
  | { kind: 'notification'; message: InboundNotification }
  | { kind: 'invalid'; error: JsonRpcErrorBody; id: JsonRpcId | null };

/** Recover a correlatable id from an otherwise-invalid message, or null. */
function recoverId(raw: unknown): JsonRpcId | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const id = (raw as Record<string, unknown>).id;
  const parsed = JsonRpcIdSchema.safeParse(id);
  return parsed.success ? parsed.data : null;
}

/**
 * Validate + classify one parsed JSON message.
 *
 * A JSON-RPC notification is defined by the ABSENCE of `id`, so that — not the
 * loose schema, which a request also satisfies — is what discriminates.
 */
export function classifyInbound(raw: unknown): InboundMessage {
  const hasId =
    typeof raw === 'object' && raw !== null && Object.prototype.hasOwnProperty.call(raw, 'id');

  if (hasId) {
    const request = InboundRequestSchema.safeParse(raw);
    if (request.success) return { kind: 'request', message: request.data };
  } else {
    const notification = InboundNotificationSchema.safeParse(raw);
    if (notification.success) return { kind: 'notification', message: notification.data };
  }

  return {
    kind: 'invalid',
    error: { code: RPC_INVALID_REQUEST, message: 'Invalid Request' },
    id: recoverId(raw),
  };
}

// ── params (only the served methods) ──

export const InitializeParamsSchema = z.looseObject({
  /** Spec-required. A client that omits it is not speaking MCP. */
  protocolVersion: z.string().min(1),
  capabilities: z.looseObject({}).optional(),
  clientInfo: z.looseObject({ name: z.string().min(1), version: z.string().optional() }).optional(),
});
export type InitializeParams = z.infer<typeof InitializeParamsSchema>;

export const ListToolsParamsSchema = z.looseObject({ cursor: z.string().optional() });
export type ListToolsParams = z.infer<typeof ListToolsParamsSchema>;

export const CallToolParamsSchema = z.looseObject({
  name: z.string().min(1),
  /** Absent arguments are legal for a zero-arg tool; normalize to `{}`. */
  arguments: z.record(z.string(), JsonValueSchema).default({}),
});
export type CallToolParams = z.infer<typeof CallToolParamsSchema>;

export const ListPromptsParamsSchema = z.looseObject({ cursor: z.string().optional() });
export type ListPromptsParams = z.infer<typeof ListPromptsParamsSchema>;

export const GetPromptParamsSchema = z.looseObject({
  name: z.string().min(1),
  arguments: z.record(z.string(), JsonValueSchema).default({}),
});
export type GetPromptParams = z.infer<typeof GetPromptParamsSchema>;

function parseParams<T>(schema: z.ZodType<T>, raw: unknown, method: string): T {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new ServerProtocolError(
      'INVALID_PARAMS',
      `Invalid params for ${method}: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

export function parseInitializeParams(raw: unknown): InitializeParams {
  return parseParams(InitializeParamsSchema, raw, 'initialize');
}

export function parseListToolsParams(raw: unknown): ListToolsParams {
  return parseParams(ListToolsParamsSchema, raw, 'tools/list');
}

export function parseCallToolParams(raw: unknown): CallToolParams {
  return parseParams(CallToolParamsSchema, raw, 'tools/call');
}

export function parseListPromptsParams(raw: unknown): ListPromptsParams {
  return parseParams(ListPromptsParamsSchema, raw, 'prompts/list');
}

export function parseGetPromptParams(raw: unknown): GetPromptParams {
  return parseParams(GetPromptParamsSchema, raw, 'prompts/get');
}

// ── outbound envelopes ──

export interface JsonRpcResultEnvelope {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  result: JsonValue;
}

export interface JsonRpcErrorEnvelope {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId | null;
  error: JsonRpcErrorBody;
}

export type JsonRpcOutbound = JsonRpcResultEnvelope | JsonRpcErrorEnvelope;

export function jsonRpcResult(id: JsonRpcId, result: JsonValue): JsonRpcResultEnvelope {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function jsonRpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
): JsonRpcErrorEnvelope {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}
