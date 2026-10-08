/**
 * RED spec for the shared MCP config builder (`src/lib/mcp/config.ts`).
 *
 * The module does NOT exist yet. This file is authored first, and its failure to
 * load `src/lib/mcp/config` at run time is the expected RED state. As in the
 * earlier spike specs, cases 1 to 5 import the missing module through a
 * string-typed dynamic specifier so the miss fails the TEST, not the repo-wide
 * `tsc` gate (a static import of a missing module is a TS2307 build break).
 *
 * WHY THIS EXISTS. Three places build the MCP config independently and disagree:
 * the Connect page (`ClientSetup.tsx`) emits the server name `workspace`, which
 * Claude Code reserves and refuses to add, and its Desktop entry omits the
 * `type: "http"` the CLI needs; the spike executor and run-matrix each carry
 * their own name. This spec pins one shared builder that owns the name, the
 * reserved list, and the single config shape, and a guard that the three callers
 * resolve their name from it rather than from an inline literal.
 *
 * NOTHING IS HARDCODED. Endpoint and token are read from the environment.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One server entry in an MCP config. `type` is fixed to the HTTP transport. */
interface McpServerEntry {
  url: string;
  type: 'http';
  headers: { Authorization: string };
}
interface McpConfig {
  mcpServers: Record<string, McpServerEntry>;
}

/** The exports the shared builder must provide for these tests to go green. */
interface ConfigModule {
  MCP_SERVER_NAME: string;
  RESERVED_SERVER_NAMES: readonly string[];
  buildMcpConfig: (endpoint: string, token: string, serverName?: string) => McpConfig;
  addJsonCommand: (endpoint: string, token: string) => string;
  desktopConfig: (endpoint: string, token: string) => string;
  vsCodeConfig: (endpoint: string, token: string) => string;
}

// A string-typed specifier keeps `tsc` from resolving the missing module, so the
// failure lands at run time inside each test.
const CONFIG_MODULE: string = '../../../src/lib/mcp/config';
async function loadConfig(): Promise<ConfigModule> {
  return (await import(CONFIG_MODULE)) as ConfigModule;
}

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`test env ${name} is not set`);
  return value;
}

/** The single-quoted JSON payload out of a `claude mcp add-json` command. */
function extractJson(command: string): string {
  const open = command.indexOf("'");
  const close = command.lastIndexOf("'");
  if (open === -1 || close <= open) throw new Error('no quoted json in command');
  return command.slice(open + 1, close);
}

// The files that emit an MCP server name and must resolve it from the shared
// constant rather than an inline literal. Scanned as source text (case 6). Not a
// repo-wide scan on purpose: the test files and docs legitimately name the
// reserved word, so only these config-emitting sources are held to the rule.
const SERVER_NAME_FILES = [
  'src/components/connect/ClientSetup.tsx',
  'scripts/spike/executor.ts',
  'scripts/spike/run-matrix.ts',
] as const;

beforeEach(() => {
  // Config a caller would receive, supplied here rather than hardcoded inline.
  process.env.MCP_TEST_ENDPOINT = 'https://mcproof.dev/api/mcp/run/spike';
  process.env.MCP_TEST_TOKEN = 'token-under-test';
});

describe('shared MCP config builder (RED: src/lib/mcp/config does not exist yet)', () => {
  it('exports the server name constant "mcp-run"', async () => {
    const { MCP_SERVER_NAME } = await loadConfig();
    expect(MCP_SERVER_NAME).toBe('mcp-run');
  });

  it('rejects every reserved server name, sourced from a named constant, including workspace', async () => {
    const { RESERVED_SERVER_NAMES, MCP_SERVER_NAME, buildMcpConfig } = await loadConfig();
    const endpoint = readEnv('MCP_TEST_ENDPOINT');
    const token = readEnv('MCP_TEST_TOKEN');

    expect(RESERVED_SERVER_NAMES).toContain('workspace');
    expect(RESERVED_SERVER_NAMES).not.toContain(MCP_SERVER_NAME);
    expect(() => buildMcpConfig(endpoint, token, 'workspace')).toThrow();
    for (const reserved of RESERVED_SERVER_NAMES) {
      expect(() => buildMcpConfig(endpoint, token, reserved)).toThrow();
    }
  });

  it('builds the VS Code file: the same entry under servers, not mcpServers', async () => {
    const { vsCodeConfig, buildMcpConfig, MCP_SERVER_NAME } = await loadConfig();
    const endpoint = readEnv('MCP_TEST_ENDPOINT');
    const token = readEnv('MCP_TEST_TOKEN');

    const parsed = JSON.parse(vsCodeConfig(endpoint, token)) as { servers: object };

    expect(Object.keys(parsed)).toEqual(['servers']);
    expect(parsed.servers).toEqual(buildMcpConfig(endpoint, token).mcpServers);
    expect(Object.keys(parsed.servers)).toEqual([MCP_SERVER_NAME]);
  });

  it('builds exactly one http server, keyed by the shared name, with a bearer header', async () => {
    const { buildMcpConfig, MCP_SERVER_NAME } = await loadConfig();
    const endpoint = readEnv('MCP_TEST_ENDPOINT');
    const token = readEnv('MCP_TEST_TOKEN');

    const config = buildMcpConfig(endpoint, token);

    expect(Object.keys(config.mcpServers)).toEqual([MCP_SERVER_NAME]);
    const entry = config.mcpServers[MCP_SERVER_NAME];
    expect(entry?.url).toBe(endpoint);
    expect(entry?.type).toBe('http');
    expect(entry?.headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('embeds the same server-entry json, including type http, in the add-json command', async () => {
    const { addJsonCommand, buildMcpConfig, MCP_SERVER_NAME } = await loadConfig();
    const endpoint = readEnv('MCP_TEST_ENDPOINT');
    const token = readEnv('MCP_TEST_TOKEN');

    const command = addJsonCommand(endpoint, token);
    expect(command.startsWith(`claude mcp add-json ${MCP_SERVER_NAME} `)).toBe(true);

    const embedded = JSON.parse(extractJson(command)) as McpServerEntry;
    expect(embedded.type).toBe('http');
    expect(embedded).toEqual(buildMcpConfig(endpoint, token).mcpServers[MCP_SERVER_NAME]);
  });

  it('gives the desktop config the same shape as the builder, including type http', async () => {
    const { desktopConfig, buildMcpConfig } = await loadConfig();
    const endpoint = readEnv('MCP_TEST_ENDPOINT');
    const token = readEnv('MCP_TEST_TOKEN');

    const parsed = JSON.parse(desktopConfig(endpoint, token)) as McpConfig;
    expect(parsed).toEqual(buildMcpConfig(endpoint, token));
  });

  it('guards that every config-emitting file resolves its name from the shared constant, never an inline "workspace"', () => {
    for (const relativePath of SERVER_NAME_FILES) {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
      expect(source, `${relativePath} should import the shared config module`).toContain(
        'lib/mcp/config',
      );
      expect(source, `${relativePath} should reference the shared name constant`).toContain(
        'MCP_SERVER_NAME',
      );
      expect(source, `${relativePath} should not inline a "workspace" server name`).not.toMatch(
        /['"]workspace['"]/,
      );
    }
  });
});
