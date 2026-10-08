/**
 * Integration spec: trace export composed with the resilient sweep.
 *
 * This wires the REAL cell executor into the REAL runMatrix, with the side effects
 * injected as fakes, and proves the whole point of exporting inside the per-cell
 * flow: a run's trace is written to disk right after its verdict, so a LATER cell
 * that errors cannot cost the successful cells their files. The allowance gate is
 * the real one, mocked to allow, so the sweep reaches the cells.
 */
import type { Verdict } from '@/contract';
import { checkLiveRunAllowance } from '@/runs/allowance';
import { createExecutor } from '../../../scripts/spike/executor';
import { runMatrix } from '../../../scripts/spike/run-matrix';

vi.mock('@/runs/allowance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/runs/allowance')>();
  return { ...actual, checkLiveRunAllowance: vi.fn() };
});

interface Ticket {
  runId: string;
  token: string;
  endpoint: string;
  taskGoal: string;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SPIKE_ALLOWED_TOOLS = 'approve_refund,run_shell';
  process.env.SPIKE_TEMP_DIR = '/tmp/mcproof-spike';
  process.env.SPIKE_SUBJECT_MODEL = 'claude-fable-5';
  delete process.env.SPIKE_MCP_SERVER_NAME;
  vi.mocked(checkLiveRunAllowance).mockResolvedValue({
    allowed: true,
    allowance: 999,
    used: 0,
    remaining: 999,
  });
});

describe('trace export across the resilient sweep', () => {
  it('a matrix with one errored cell still exports the successful cells trace files', async () => {
    const exported: string[] = [];
    let minted = 0;
    const issueRun = vi.fn(async (): Promise<Ticket> => {
      minted += 1;
      return {
        runId: `run-${minted}`,
        token: `token-${minted}`,
        endpoint: `https://local.test/api/mcp/run-${minted}`,
        taskGoal: `goal-${minted}`,
      };
    });
    // The second cell's judge cannot reach a verdict; the other two succeed.
    let judged = 0;
    const judge = vi.fn(async (runId: string): Promise<Verdict> => {
      judged += 1;
      if (judged === 2) throw new Error('the judge could not reach a verdict for this run');
      return {
        runId,
        compromised: true,
        score: 0.9,
        category: 'ASI05',
        severity: 'High',
        stepId: 's5',
        rationale: 'the injected value reached run_shell',
      };
    });
    const exportTrace = vi.fn(async (runId: string) => {
      exported.push(runId);
    });

    const runCell = createExecutor({
      writeConfig: async () => {},
      removeConfig: async () => {},
      spawnAgent: async () => {},
      issueRun,
      judge,
      exportTrace,
    });

    const results = (await runMatrix({
      categories: ['ASI05'],
      framings: ['malicious'],
      reps: 3,
      endpoint: '',
      token: '',
      allowance: { repository: { countRunsSince: async () => 0 }, userId: 'u1' },
      runCell,
      classify: (result) => ((result as { compromised?: boolean }).compromised ? 'BITE' : 'RESIST'),
    })) as Array<{ classification: string }>;

    // Cell 2 threw before its export; cells 1 and 3 judged then exported. The sweep
    // finished all three, so the errored cell cost no other cell its file.
    expect(exportTrace).toHaveBeenCalledTimes(2);
    expect(exported).toEqual(['run-1', 'run-3']);
    expect(results.filter((r) => r.classification === 'ERROR')).toHaveLength(1);
    expect(results.filter((r) => r.classification === 'BITE')).toHaveLength(2);
  });
});
