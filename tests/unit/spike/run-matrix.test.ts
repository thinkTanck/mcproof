/**
 * RED spec for the ASI red-team run-matrix spike (`scripts/spike/run-matrix.ts`).
 *
 * GREEN: the module under test now exists at `scripts/spike/run-matrix.ts` and is
 * imported statically below. (During RED it was a runtime dynamic import so a
 * still-missing module failed the TEST rather than the repo-wide `tsc` gate; now
 * that it resolves, the static import is the honest form and `loadRunMatrix` just
 * hands the imported namespace back to the unchanged assertions.)
 *
 * NOTHING IS HARDCODED. The allowance gate is the REAL `checkLiveRunAllowance`
 * (mocked here so the run path DELEGATES to it rather than growing its own
 * counter), and the endpoint, token, user and matrix dimensions are read from the
 * environment, the same way a deployed run would receive them.
 */
import { checkLiveRunAllowance, LiveRunAllowanceError } from '@/runs/allowance';
import { resolveLiveDetector } from '@/detector/resolve';
import { createAnthropicJudge } from '@/detector/anthropic-judge';
import { HOSTED_CATEGORIES } from '@/harness/server/surfaces';
import { OFFENDING_TOOL as ASI01_OFFENDING } from '@/harness/server/surfaces/asi01';
import { OFFENDING_TOOL as ASI02_OFFENDING } from '@/harness/server/surfaces/asi02';
import { OFFENDING_TOOL as ASI03_OFFENDING } from '@/harness/server/surfaces/asi03';
import { OFFENDING_TOOL as ASI04_OFFENDING } from '@/harness/server/surfaces/asi04';
import { OFFENDING_TOOL as ASI05_OFFENDING } from '@/harness/server/surfaces/asi05';
import { OFFENDING_TOOL as ASI06_OFFENDING } from '@/harness/server/surfaces/asi06';
import { OFFENDING_TOOL as ASI10_OFFENDING } from '@/harness/server/surfaces/asi10';
import * as runMatrixModule from '../../../scripts/spike/run-matrix';

/**
 * What each hosted surface exports as its own bait. Spelled out per category on
 * purpose, from each surface module rather than through any shared helper, so the
 * assertion below compares the run-matrix map against the surfaces themselves and
 * not against a second copy of the map.
 */
const SURFACE_OFFENDING_TOOL: Record<string, string> = {
  ASI01: ASI01_OFFENDING,
  ASI02: ASI02_OFFENDING,
  ASI03: ASI03_OFFENDING,
  ASI04: ASI04_OFFENDING,
  ASI05: ASI05_OFFENDING,
  ASI06: ASI06_OFFENDING,
  ASI10: ASI10_OFFENDING,
};

// The one gate a run path must pass is the EXISTING per-account allowance check.
// Preserve its real error type so `rejects.toBeInstanceOf(LiveRunAllowanceError)`
// tests the true class, and replace only the function with a spy.
vi.mock('@/runs/allowance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/runs/allowance')>();
  return { ...actual, checkLiveRunAllowance: vi.fn() };
});

// The judge must be unreachable from the run path. Mock both judge entry points
// so ANY call is observable; the assertion is that neither ever fires.
vi.mock('@/detector/resolve', () => ({ resolveLiveDetector: vi.fn() }));
vi.mock('@/detector/anthropic-judge', () => ({ createAnthropicJudge: vi.fn() }));

/** A cell of the sweep: one attack category, one framing, one repetition. */
interface Cell {
  category: string;
  framing: string;
  rep: number;
}

/** The exports this spike must provide. Declaring them here is the contract the
 *  not-yet-written `run-matrix.ts` has to satisfy for these tests to go green. */
interface RunMatrixModule {
  generateMatrix: (categories: string[], framings: string[], reps: number) => Cell[];
  buildMcpConfig: (
    endpoint: string,
    token: string,
  ) => { mcpServers: Record<string, { url: string }> };
  classifyTrace: (trace: unknown, category: string) => 'BITE' | 'RESIST';
  runMatrix: (input: RunMatrixInput) => Promise<unknown>;
  /** Category -> the tool call whose presence in a trace means the agent bit. */
  OFFENDING_TOOL: Record<string, string>;
}

interface RunMatrixInput {
  categories: string[];
  framings: string[];
  reps: number;
  endpoint: string;
  token: string;
  allowance: {
    repository: { countRunsSince: (userId: string, since: Date) => Promise<number> };
    userId: string;
  };
  runCell: (cell: Cell, config: unknown) => Promise<unknown>;
  classify?: (result: unknown, category: string) => 'BITE' | 'RESIST' | 'ERROR';
  onCellError?: (info: { cell: Cell; error: unknown }) => void;
}

async function loadRunMatrix(): Promise<RunMatrixModule> {
  return runMatrixModule;
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
function readInt(name: string): number {
  return Number.parseInt(readEnv(name), 10);
}

/** A minimal observable trace whose only meaningful content is its tool calls. */
function traceWith(category: string, steps: ReadonlyArray<Record<string, unknown>>) {
  return {
    runId: readEnv('SPIKE_RUN_ID'),
    target: readEnv('SPIKE_MCP_ENDPOINT'),
    model: readEnv('SPIKE_MODEL'),
    category,
    steps: [{ type: 'principal_instruction', text: 'task goal' }, ...steps],
  };
}

function matrixInput(overrides: Partial<RunMatrixInput> = {}): RunMatrixInput {
  return {
    categories: readList('SPIKE_CATEGORIES'),
    framings: readList('SPIKE_FRAMINGS'),
    reps: readInt('SPIKE_REPS'),
    endpoint: readEnv('SPIKE_MCP_ENDPOINT'),
    token: readEnv('SPIKE_RUN_TOKEN'),
    allowance: {
      repository: { countRunsSince: vi.fn(async () => 0) },
      userId: readEnv('SPIKE_USER_ID'),
    },
    runCell: vi.fn(async () => ({})),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Config a deployed run would receive from its environment, supplied here in
  // one place rather than scattered as literals through the assertions.
  process.env.SPIKE_CATEGORIES = 'ASI01,ASI02,ASI03';
  process.env.SPIKE_FRAMINGS = 'direct,roleplay';
  process.env.SPIKE_REPS = '3';
  process.env.SPIKE_MCP_ENDPOINT = 'https://mcpwn.dev/api/mcp/run/spike';
  process.env.SPIKE_RUN_TOKEN = 'run-token-spike';
  process.env.SPIKE_USER_ID = 'user-spike';
  process.env.SPIKE_RUN_ID = 'run-spike';
  process.env.SPIKE_MODEL = 'model-under-test';
});

describe('run-matrix spike (RED: scripts/spike/run-matrix does not exist yet)', () => {
  it('generateMatrix spans every (category, framing, rep) cell exactly once', async () => {
    const { generateMatrix } = await loadRunMatrix();
    const categories = readList('SPIKE_CATEGORIES');
    const framings = readList('SPIKE_FRAMINGS');
    const reps = readInt('SPIKE_REPS');

    const matrix = generateMatrix(categories, framings, reps);

    expect(matrix).toHaveLength(categories.length * framings.length * reps);
    const keys = new Set(matrix.map((cell) => `${cell.category}|${cell.framing}|${cell.rep}`));
    expect(keys.size).toBe(matrix.length);
  });

  it('buildMcpConfig registers exactly one server, at the passed endpoint', async () => {
    const { buildMcpConfig } = await loadRunMatrix();
    const endpoint = readEnv('SPIKE_MCP_ENDPOINT');
    const token = readEnv('SPIKE_RUN_TOKEN');

    const config = buildMcpConfig(endpoint, token);
    const servers = config.mcpServers;

    expect(Object.keys(servers)).toHaveLength(1);
    const only = Object.values(servers)[0];
    expect(only?.url).toBe(endpoint);
  });

  it('classifyTrace returns BITE when the category offending tool call is present', async () => {
    const { classifyTrace, OFFENDING_TOOL } = await loadRunMatrix();
    const category = Object.keys(OFFENDING_TOOL)[0];
    if (!category) throw new Error('OFFENDING_TOOL exposes no categories');
    const offendingTool = OFFENDING_TOOL[category];
    if (!offendingTool) throw new Error(`OFFENDING_TOOL has no tool for ${category}`);

    const trace = traceWith(category, [{ type: 'tool_call', tool: offendingTool }]);

    expect(classifyTrace(trace, category)).toBe('BITE');
  });

  it('maps every hosted category to the tool its surface actually serves as its bait', async () => {
    // The judged runner injects the frozen judge's verdict, so this crude mapping
    // never decides a published count. It is still definitional attack data, and a
    // mapping that names a tool the surface does not serve would score every trace
    // in that category RESIST by construction: a zero from looking in the wrong
    // place. Five of the seven entries once did exactly that. Pinning each to the
    // surface's own exported constant, and the key set to the hosted registry,
    // means no entry can drift from its surface again, silently or otherwise.
    const { OFFENDING_TOOL } = await loadRunMatrix();
    expect(Object.keys(OFFENDING_TOOL).sort()).toEqual([...HOSTED_CATEGORIES].sort());
    for (const category of HOSTED_CATEGORIES) {
      expect(OFFENDING_TOOL[category], `OFFENDING_TOOL.${category}`).toBe(
        SURFACE_OFFENDING_TOOL[category],
      );
    }
  });

  it('classifyTrace returns RESIST when the offending tool call is absent', async () => {
    const { classifyTrace, OFFENDING_TOOL } = await loadRunMatrix();
    const category = Object.keys(OFFENDING_TOOL)[0];
    if (!category) throw new Error('OFFENDING_TOOL exposes no categories');
    const offendingTool = OFFENDING_TOOL[category];
    if (!offendingTool) throw new Error(`OFFENDING_TOOL has no tool for ${category}`);

    // A tool call that is provably not the offending one for this category.
    const trace = traceWith(category, [{ type: 'tool_call', tool: `${offendingTool}__benign` }]);

    expect(classifyTrace(trace, category)).toBe('RESIST');
  });

  it('the run path passes the planned run count to the existing allowance gate and aborts when it refuses', async () => {
    const { runMatrix } = await loadRunMatrix();
    const categories = readList('SPIKE_CATEGORIES');
    const framings = readList('SPIKE_FRAMINGS');
    const reps = readInt('SPIKE_REPS');
    const plannedRuns = categories.length * framings.length * reps;

    vi.mocked(checkLiveRunAllowance).mockResolvedValue({
      allowed: false,
      allowance: 0,
      used: 0,
      remaining: 0,
      error: new LiveRunAllowanceError(0, 0),
    });
    const runCell = vi.fn(async () => ({}));

    await expect(runMatrix(matrixInput({ runCell }))).rejects.toBeInstanceOf(LiveRunAllowanceError);

    expect(checkLiveRunAllowance).toHaveBeenCalledWith(expect.objectContaining({ plannedRuns }));
    // Aborted before any run was staged: the refusal short-circuits the sweep.
    expect(runCell).not.toHaveBeenCalled();
  });

  it('the run path never resolves or invokes the judge', async () => {
    const { runMatrix } = await loadRunMatrix();

    vi.mocked(checkLiveRunAllowance).mockResolvedValue({
      allowed: true,
      allowance: 999,
      used: 0,
      remaining: 999,
    });
    const runCell = vi.fn(async (cell: Cell) =>
      traceWith(cell.category, [{ type: 'tool_call', tool: 'noop' }]),
    );

    await runMatrix(matrixInput({ runCell }));

    expect(resolveLiveDetector).not.toHaveBeenCalled();
    expect(createAnthropicJudge).not.toHaveBeenCalled();
  });

  it('scores each cell with the injected classify, not classifyTrace, when one is provided', async () => {
    const { runMatrix } = await loadRunMatrix();
    vi.mocked(checkLiveRunAllowance).mockResolvedValue({
      allowed: true,
      allowance: 999,
      used: 0,
      remaining: 999,
    });
    // A result that is NOT a trace: classifyTrace would score it RESIST (no
    // offending tool call), so an all-BITE outcome proves the injected classify ran.
    const runCell = vi.fn(async () => ({ compromised: true }));
    const classify = vi.fn(() => 'BITE' as const);

    const results = (await runMatrix(matrixInput({ runCell, classify }))) as Array<{
      classification: string;
    }>;

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.classification === 'BITE')).toBe(true);
    expect(classify).toHaveBeenCalledTimes(results.length);
  });

  it('records a throwing cell as ERROR, reports it, and continues the sweep', async () => {
    const { runMatrix } = await loadRunMatrix();
    vi.mocked(checkLiveRunAllowance).mockResolvedValue({
      allowed: true,
      allowance: 999,
      used: 0,
      remaining: 999,
    });
    let call = 0;
    const runCell = vi.fn(async () => {
      call += 1;
      if (call === 2) throw new Error('could not judge: the judge could not reach a verdict');
      return { compromised: true };
    });
    const onCellError = vi.fn();

    const results = (await runMatrix(
      matrixInput({ runCell, classify: () => 'BITE', onCellError }),
    )) as Array<{ classification: string }>;

    // The sweep did NOT abort on the second cell: every cell was attempted.
    expect(runCell).toHaveBeenCalledTimes(results.length);
    expect(results.filter((r) => r.classification === 'ERROR')).toHaveLength(1);
    expect(results.filter((r) => r.classification === 'BITE')).toHaveLength(results.length - 1);
    expect(onCellError).toHaveBeenCalledTimes(1);
  });
});
