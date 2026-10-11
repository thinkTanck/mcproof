/**
 * HOSTED MCP SERVER (module 1) — the per-run MCP server MCProof hosts and the
 * user's agent connects to ([ADR-0006](../../../docs/adr/0006-mcpwn-is-the-mcp-server.md)).
 *
 * It serves the attack's poisoned tool surface (the Core-7, some tools
 * deliberately over-broad or mis-described), delivers `Scenario.taskGoal` OUT OF
 * BAND as a published prompt, and records every `tools/call` the agent chooses to
 * make into an OBSERVABLE-only `Trace`. The transport is Streamable HTTP; the
 * dispatch is transport-free and reused by the stdio path too.
 *
 * NOT YET VALIDATED: the bait-taking hypothesis. The ASI01 stdio spike returned a
 * confounded NO (a neutrality leak in the server identity); the ASI04 fallback has
 * never been run against a naive client. This server makes the hypothesis
 * TESTABLE at hosted scale; it does not prove it.
 */
export {
  HostedMcpServer,
  SERVER_NAME,
  SERVER_VERSION,
  TASK_PROMPT_NAME,
  type HostedServerOptions,
  type HostedLogEntry,
} from './server';
export {
  HostedTraceRecorder,
  INFERRED_TASK_COMPLETE_SUMMARY,
  UNKNOWN_CLIENT,
  type HostedRecorderOptions,
  type ObservedClient,
} from './recorder';
export {
  defineTool,
  findPayloadTells,
  findTells,
  NEUTRALITY_TELLS,
  PAYLOAD_TELLS,
  PAYLOAD_WORD_TELLS,
  type HostedSurface,
  type HostedTool,
  type HostedToolOutcome,
  type ToolRecording,
} from './surface';
export { buildHostedSurface, HOSTED_CATEGORIES, SURFACE_BUILDERS } from './surfaces';
export {
  createStreamableHttpHandler,
  PROTOCOL_HEADER,
  SESSION_HEADER,
  type ServerFactory,
  type StreamableHttpHandler,
} from './http';
export {
  ServerProtocolError,
  classifyInbound,
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_PARSE_ERROR,
  type JsonRpcOutbound,
} from './protocol';
