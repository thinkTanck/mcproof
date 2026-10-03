/**
 * The one place an MCP server config is built.
 *
 * Three callers used to build this shape independently and disagree: the Connect
 * page named the server `workspace` (which Claude Code reserves and refuses to
 * add) and omitted the `type: "http"` its config needs; the spike executor and
 * run-matrix each carried their own name. This module owns the name, the reserved
 * list, and the single config shape, so a fix lands in one place.
 *
 * Nothing here reads the environment: endpoint and token are passed in by the
 * caller, which is where the run's config comes from.
 */

/** The neutral server id every config uses. Neutral on purpose: the client
 *  namespaces the served tools with it, so a name like `mcpwn` or `red-team`
 *  would tell a connecting agent it is being tested before the run starts. */
export const MCP_SERVER_NAME = 'mcp-run';

/**
 * Server names Claude Code reserves and refuses to register. Empirically
 * confirmed against Claude Code 2.1.234, which answers `claude mcp add`/`add-json`
 * for `workspace` with `Cannot add MCP server "workspace": this name is reserved`.
 * The list is a named constant so callers exclude by membership, not by a literal.
 */
export const RESERVED_SERVER_NAMES = ['workspace'] as const;

/** One server entry. `type` is fixed to the HTTP transport the endpoint speaks. */
export interface McpServerEntry {
  url: string;
  type: 'http';
  headers: { Authorization: string };
}

/** An MCP client config naming exactly the one server the agent connects to. */
export interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

function isReserved(name: string): boolean {
  return (RESERVED_SERVER_NAMES as readonly string[]).includes(name);
}

/** The single HTTP server entry: the endpoint, the transport, the bearer token. */
function buildServerEntry(endpoint: string, token: string): McpServerEntry {
  return { url: endpoint, type: 'http', headers: { Authorization: `Bearer ${token}` } };
}

/**
 * Build the one-server config the agent connects to. Defaults to the neutral
 * shared name; a caller may pass another, but a reserved name is refused rather
 * than silently emitted, because Claude Code would reject it at registration.
 */
export function buildMcpConfig(
  endpoint: string,
  token: string,
  serverName: string = MCP_SERVER_NAME,
): McpConfig {
  if (isReserved(serverName)) {
    throw new Error(`MCP server name "${serverName}" is reserved by Claude Code`);
  }
  return { mcpServers: { [serverName]: buildServerEntry(endpoint, token) } };
}

/** The `claude mcp add-json` command, embedding the server entry as its JSON. */
export function addJsonCommand(endpoint: string, token: string): string {
  return `claude mcp add-json ${MCP_SERVER_NAME} '${JSON.stringify(buildServerEntry(endpoint, token))}'`;
}

/** The `claude_desktop_config.json` entry: the same config, pretty-printed. */
export function desktopConfig(endpoint: string, token: string): string {
  return JSON.stringify(buildMcpConfig(endpoint, token), null, 2);
}

/**
 * The `.vscode/mcp.json` file. VS Code reads the same server entry under a
 * `servers` key where every other client here reads `mcpServers`, so it is built
 * from the same config rather than left for the reader to rename by hand.
 */
export function vsCodeConfig(endpoint: string, token: string): string {
  return JSON.stringify({ servers: buildMcpConfig(endpoint, token).mcpServers }, null, 2);
}
