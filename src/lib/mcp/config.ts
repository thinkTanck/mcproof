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
 *  namespaces the served tools with it, so a name like `mcproof` or `red-team`
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

/** The plain `mcpServers` file: the same config, pretty-printed. */
export function desktopConfig(endpoint: string, token: string): string {
  return JSON.stringify(buildMcpConfig(endpoint, token), null, 2);
}

/*
 * ── ONE BUILDER PER CLIENT ──
 *
 * Each client reads a remote Streamable HTTP server with a static
 * `Authorization` header in a format of its own. Every format below was read
 * off that client's own documentation on 2026-10-10 and none was written from
 * memory: they differ in the top-level key, in whether a `type` is wanted, in
 * the name of the URL field, and in JSON against TOML.
 *
 *   Claude Code   https://code.claude.com/docs/en/mcp
 *                 `mcpServers`, `"type": "http"`, `url`, `headers`.
 *   VS Code       https://code.visualstudio.com/docs/copilot/reference/mcp-configuration
 *                 `.vscode/mcp.json`, top-level `servers`, `type` ("http" or
 *                 "sse", required), `url`, `headers` ("HTTP headers for
 *                 authentication or configuration").
 *   Cursor        https://cursor.com/docs/context/mcp
 *                 `.cursor/mcp.json`, `mcpServers`, `url`, `headers`. The
 *                 remote example carries no `type`; that field is documented
 *                 for stdio servers only, so none is emitted.
 *   Codex         https://developers.openai.com/codex/mcp (redirects to
 *                 https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
 *                 `~/.codex/config.toml`, a `[mcp_servers.<name>]` table, `url`,
 *                 and `http_headers` ("Map of header names to static values").
 *                 No experimental switch is documented as needed. The
 *                 documented alternative, `bearer_token_env_var`, is not used:
 *                 a static header keeps this to one block.
 *   Gemini CLI    https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
 *                 `.gemini/settings.json`, `mcpServers`, `httpUrl` for
 *                 Streamable HTTP (`url` selects SSE, which this endpoint does
 *                 not speak), `headers` ("Custom HTTP headers when using `url`
 *                 or `httpUrl`"). No `type` field is documented.
 *
 * Every builder takes the token as an argument and reads nothing else, so the
 * Connect screen can build each one twice: once with the real token for the
 * clipboard, once with a mask for the screen.
 */

/** Claude Code's `--mcp-config` file. */
export function claudeCodeConfig(endpoint: string, token: string): string {
  return desktopConfig(endpoint, token);
}

/** The generic `mcpServers` block, for an agent or app with no tab of its own. */
export function genericConfig(endpoint: string, token: string): string {
  return desktopConfig(endpoint, token);
}

/**
 * The `.vscode/mcp.json` file. VS Code reads the same server entry under a
 * `servers` key where every other client here reads `mcpServers`, so it is built
 * from the same config rather than left for the reader to rename by hand.
 */
export function vsCodeConfig(endpoint: string, token: string): string {
  return JSON.stringify({ servers: buildMcpConfig(endpoint, token).mcpServers }, null, 2);
}

/** The `.cursor/mcp.json` file: `url` and `headers`, with no `type`. */
export function cursorConfig(endpoint: string, token: string): string {
  const { url, headers } = buildServerEntry(endpoint, token);
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { url, headers } } }, null, 2);
}

/** The `.gemini/settings.json` file: `httpUrl` selects Streamable HTTP. */
export function geminiConfig(endpoint: string, token: string): string {
  const { url, headers } = buildServerEntry(endpoint, token);
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { httpUrl: url, headers } } }, null, 2);
}

/**
 * The table to ADD to `~/.codex/config.toml`. A JSON string literal of plain
 * text is also a valid TOML basic string (the same quotes and the same
 * backslash escapes), so the values are quoted with `JSON.stringify` and no
 * TOML library is needed. The server name is a bare key, which TOML allows for
 * letters, digits, dashes and underscores.
 */
export function codexConfig(endpoint: string, token: string): string {
  const { url, headers } = buildServerEntry(endpoint, token);
  return (
    `[mcp_servers.${MCP_SERVER_NAME}]\n` +
    `url = ${JSON.stringify(url)}\n` +
    `http_headers = { "Authorization" = ${JSON.stringify(headers.Authorization)} }\n`
  );
}
