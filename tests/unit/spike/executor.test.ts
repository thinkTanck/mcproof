/**
 * Spec for the run-matrix cell executor (`scripts/spike/executor.ts`).
 *
 * The executor is the function `runMatrix` injects for each cell. For each cell it
 * MINTS ITS OWN RUN, spawns the agent against a one-server MCP config, then JUDGES
 * the run and returns the frozen judge's Verdict. It no longer reads a raw trace or
 * calls `classifyTrace`: the judge is the scorer now. Nothing real is launched or
 * requested here: the filesystem, the spawn, the mint and the judge are all
 * injected mocks.
 *
 * Per-cell endpoint and goal come from the ticket, never a static env var. The
 * allowed-tools list, temp dir, server name and subject model are read from the
 * environment. Nothing hardcoded.
 */
import type { Mock } from 'vitest';
import { classifyTrace } from '../../../scripts/spike/run-matrix';
import * as executorModule from '../../../scripts/spike/executor';

// classifyTrace stays importable (other categories still use it), but the executor
// must not call it any more; keep the spy so we can assert it never fires.
vi.mock('../../../scripts/spike/run-matrix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../scripts/spike/run-matrix')>();
  return { ...actual, classifyTrace: vi.fn(() => 'RESIST' as const) };
});

/** One cell of the sweep (mirrors run-matrix's Cell, kept local on purpose). */
interface Cell {
  category: string;
  framing: string;
  rep: number;
}

/** What one cell's mint hands back: the per-run endpoint, goal and credential. */
interface RunTicket {
  runId: string;
  token: string;
  endpoint: string;
  taskGoal: string;
}

/** The frozen judge's verdict (the fields the runner reads). */
interface VerdictLike {
  runId: string;
  compromised: boolean;
  category: string;
}

/** The dependencies the executor takes, all injected so nothing real happens. */
interface ExecutorDeps {
  writeConfig: (path: string, contents: string) => Promise<void>;
  removeConfig: (path: string) => Promise<void>;
  spawnAgent: (command: string, args: readonly string[]) => Promise<void>;
  judge: (runId: string) => Promise<VerdictLike>;
  issueRun: (cell: Cell) => Promise<RunTicket>;
  /** Persist the judged run's trace to disk, so it survives the reaper. */
  exportTrace: (
    runId: string,
    category: string,
    framing: string,
    verdict: VerdictLike,
  ) => Promise<void>;
}

/** The one export this spike must provide. */
interface ExecutorModule {
  createExecutor: (deps: ExecutorDeps) => (cell: Cell) => Promise<unknown>;
}

/** The mocked shape of the deps, carrying the spies the assertions read. */
interface DepMocks {
  writeConfig: Mock<(path: string, contents: string) => Promise<void>>;
  removeConfig: Mock<(path: string) => Promise<void>>;
  spawnAgent: Mock<(command: string, args: readonly string[]) => Promise<void>>;
  judge: Mock<(runId: string) => Promise<VerdictLike>>;
  issueRun: Mock<(cell: Cell) => Promise<RunTicket>>;
  exportTrace: Mock<
    (runId: string, category: string, framing: string, verdict: VerdictLike) => Promise<void>
  >;
}

interface WrittenServer {
  url: string;
  type: string;
  headers: { Authorization: string };
}
interface WrittenConfig {
  mcpServers: Record<string, WrittenServer>;
}

/** The fixed verdict the judge resolves to, so the return can be identified. */
const VERDICT: VerdictLike = { runId: 'judged', compromised: true, category: 'ASI02' };

async function loadExecutor(): Promise<ExecutorModule> {
  return executorModule as unknown as ExecutorModule;
}

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`test env ${name} is not set`);
  return value;
}
function readList(name: string): string[] {
  return readEnv(name)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Fresh mocks per test, plus the tickets `issueRun` handed out, in order. */
function makeHarness(): { mocks: DepMocks; tickets: RunTicket[] } {
  const tickets: RunTicket[] = [];
  const mocks: DepMocks = {
    writeConfig: vi.fn<(path: string, contents: string) => Promise<void>>(async () => {}),
    removeConfig: vi.fn<(path: string) => Promise<void>>(async () => {}),
    spawnAgent: vi.fn<(command: string, args: readonly string[]) => Promise<void>>(async () => {}),
    judge: vi.fn<(runId: string) => Promise<VerdictLike>>(async () => VERDICT),
    exportTrace: vi.fn<
      (runId: string, category: string, framing: string, verdict: VerdictLike) => Promise<void>
    >(async () => {}),
    issueRun: vi.fn<(cell: Cell) => Promise<RunTicket>>(async () => {
      const n = tickets.length + 1;
      const ticket: RunTicket = {
        runId: `run-${n}`,
        token: `token-${n}`,
        endpoint: `https://local.test/api/mcp/run-${n}`,
        taskGoal: `goal-${n}`,
      };
      tickets.push(ticket);
      return ticket;
    }),
  };
  return { mocks, tickets };
}

function firstCall<A extends unknown[]>(mock: { mock: { calls: A[] } }): A {
  const call = mock.mock.calls[0];
  if (call === undefined) throw new Error('expected the mock to have been called');
  return call;
}

function parseConfig(contents: string): WrittenConfig {
  return JSON.parse(contents) as WrittenConfig;
}

function serverNameWritten(mocks: DepMocks): string {
  const [, contents] = firstCall(mocks.writeConfig);
  const names = Object.keys(parseConfig(contents).mcpServers);
  const only = names[0];
  if (only === undefined) throw new Error('written config has no server');
  return only;
}

const CELL: Cell = { category: 'ASI02', framing: 'malicious', rep: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SPIKE_ALLOWED_TOOLS = 'approve_refund,send_email,read_wiki';
  process.env.SPIKE_TEMP_DIR = '/tmp/mcproof-spike';
  process.env.SPIKE_SUBJECT_MODEL = 'claude-fable-5';
  delete process.env.SPIKE_MCP_SERVER_NAME;
});

describe('executor spike', () => {
  it('writes an mcp config with exactly one server, at the cell minted endpoint', async () => {
    const { createExecutor } = await loadExecutor();
    const { mocks, tickets } = makeHarness();

    await createExecutor(mocks)(CELL);

    const [, contents] = firstCall(mocks.writeConfig);
    const servers = parseConfig(contents).mcpServers;
    expect(Object.keys(servers)).toHaveLength(1);
    const only = Object.values(servers)[0];
    expect(only?.url).toBe(tickets[0]?.endpoint);
  });

  it('spawns with --strict-mcp-config, --mcp-config at the written file, and the subject --model', async () => {
    const { createExecutor } = await loadExecutor();
    const { mocks } = makeHarness();

    await createExecutor(mocks)(CELL);

    const [writtenPath] = firstCall(mocks.writeConfig);
    const [, args] = firstCall(mocks.spawnAgent);
    expect(args).toContain('--strict-mcp-config');
    const cfgIndex = args.indexOf('--mcp-config');
    expect(cfgIndex).toBeGreaterThanOrEqual(0);
    expect(args[cfgIndex + 1]).toBe(writtenPath);
    const modelIndex = args.indexOf('--model');
    expect(modelIndex).toBeGreaterThanOrEqual(0);
    expect(args[modelIndex + 1]).toBe(readEnv('SPIKE_SUBJECT_MODEL'));
  });

  it('passes the cell goal as the -p prompt, with nothing prepended or appended', async () => {
    const { createExecutor } = await loadExecutor();
    const { mocks, tickets } = makeHarness();

    await createExecutor(mocks)(CELL);

    const [, args] = firstCall(mocks.spawnAgent);
    const pIndex = args.indexOf('-p');
    expect(pIndex).toBeGreaterThanOrEqual(0);
    expect(args[pIndex + 1]).toBe(tickets[0]?.taskGoal);
  });

  it('deletes the temp config after the cell, including when the spawn throws', async () => {
    const { createExecutor } = await loadExecutor();
    const { mocks } = makeHarness();
    mocks.spawnAgent.mockRejectedValue(new Error('agent crashed'));

    await createExecutor(mocks)(CELL).catch(() => undefined);

    const [writtenPath] = firstCall(mocks.writeConfig);
    expect(mocks.removeConfig).toHaveBeenCalledWith(writtenPath);
  });

  it('judges the run it issued and returns the verdict, without calling classifyTrace', async () => {
    const { createExecutor } = await loadExecutor();
    const { mocks, tickets } = makeHarness();

    const result = await createExecutor(mocks)(CELL);

    const issued = tickets[0];
    expect(issued).toBeDefined();
    expect(mocks.judge).toHaveBeenCalledWith(issued?.runId);
    expect(result).toBe(VERDICT);
    expect(vi.mocked(classifyTrace)).not.toHaveBeenCalled();
  });

  it('exports the judged run trace with its verdict before returning, so it survives the reaper', async () => {
    const { createExecutor } = await loadExecutor();
    const { mocks, tickets } = makeHarness();

    const result = await createExecutor(mocks)(CELL);

    const issued = tickets[0];
    expect(issued).toBeDefined();
    // The export carries this cell's identity and the frozen judge's verdict, and
    // the verdict it exports is exactly the one the executor returns.
    expect(mocks.exportTrace).toHaveBeenCalledWith(
      issued?.runId,
      CELL.category,
      CELL.framing,
      VERDICT,
    );
    expect(result).toBe(VERDICT);
    // Judged first, then exported: the verdict cannot be exported before it exists.
    const judgedAt = mocks.judge.mock.invocationCallOrder[0];
    const exportedAt = mocks.exportTrace.mock.invocationCallOrder[0];
    expect(judgedAt).toBeLessThan(exportedAt ?? 0);
  });

  it('mints a fresh run for every cell and reuses no token', async () => {
    const { createExecutor } = await loadExecutor();
    const { mocks } = makeHarness();
    const executor = createExecutor(mocks);
    const cells: Cell[] = [
      { category: 'ASI01', framing: 'malicious', rep: 0 },
      { category: 'ASI02', framing: 'benign', rep: 1 },
      { category: 'ASI03', framing: 'malicious', rep: 2 },
    ];

    for (const cell of cells) await executor(cell);

    expect(mocks.issueRun).toHaveBeenCalledTimes(cells.length);
    const tokens = mocks.writeConfig.mock.calls.map(([, contents]) => {
      const only = Object.values(parseConfig(contents).mcpServers)[0];
      return only?.headers.Authorization;
    });
    expect(new Set(tokens).size).toBe(cells.length);
  });

  it('passes the cell category to the mint, so each run serves the right surface', async () => {
    const { createExecutor } = await loadExecutor();
    const { mocks } = makeHarness();

    await createExecutor(mocks)(CELL);

    expect(mocks.issueRun).toHaveBeenCalledWith(CELL);
  });

  it('spawns with a non-empty --allowedTools sourced from config', async () => {
    const { createExecutor } = await loadExecutor();
    const { mocks } = makeHarness();

    await createExecutor(mocks)(CELL);

    const [, args] = firstCall(mocks.spawnAgent);
    const flagIndex = args.indexOf('--allowedTools');
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    const value = args[flagIndex + 1];
    expect(value).toBeTruthy();
    expect(value).toBe(readList('SPIKE_ALLOWED_TOOLS').join(','));
  });

  it('names the server the configured name, defaults to mcp-run, and never uses the reserved workspace', async () => {
    const { createExecutor } = await loadExecutor();

    process.env.SPIKE_MCP_SERVER_NAME = 'my-mcp-server';
    const configured = makeHarness();
    await createExecutor(configured.mocks)(CELL);
    expect(serverNameWritten(configured.mocks)).toBe('my-mcp-server');

    delete process.env.SPIKE_MCP_SERVER_NAME;
    const defaulted = makeHarness();
    await createExecutor(defaulted.mocks)(CELL);
    expect(serverNameWritten(defaulted.mocks)).toBe('mcp-run');

    process.env.SPIKE_MCP_SERVER_NAME = 'workspace';
    const reserved = makeHarness();
    await createExecutor(reserved.mocks)(CELL);
    const name = serverNameWritten(reserved.mocks);
    expect(name).not.toBe('workspace');
    expect(name).toBe('mcp-run');
  });
});
