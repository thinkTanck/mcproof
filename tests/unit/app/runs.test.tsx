import { render, screen, within } from '@testing-library/react';
import RunReplayPage from '@/app/(hud)/runs/[id]/page';
import { RunResultSchema, type RunResult } from '@/contract';
import { TraceBuilder } from '@/attacks/engine';
import { SAMPLE_RUN_ID } from '@/data/source';
import { SAMPLE_VERDICT_PROVENANCE } from '@/data/fixtures/sample-verdicts';
import { getUser } from '@/lib/auth/user';
import { getRunRepository } from '@/data/run-repository.factory';
import type { StoredRun } from '@/data/run-repository';

vi.mock('@/lib/auth/user', () => ({ getUser: vi.fn() }));
vi.mock('@/data/run-repository.factory', () => ({ getRunRepository: vi.fn() }));

const asMock = <T extends (...args: never[]) => unknown>(fn: T) => vi.mocked(fn);

/**
 * A persisted live run, built the way the pipeline builds one: an observable
 * trace, a judged verdict, no ground truth. Every value is distinct from the
 * sample so a literal baked into the screen cannot pass.
 */
function liveRun(compromised: boolean): RunResult {
  const b = new TraceBuilder({
    runId: 'live-run-0002',
    target: '/api/mcp',
    model: 'live-model-x',
    category: 'ASI02',
  });
  b.principalInstruction('summarize the quarterly report');
  const offending = b.toolCall('read_file', { path: '../../etc/shadow' });
  b.taskComplete('done');
  const trace = b.build();
  return RunResultSchema.parse({
    runId: 'live-run-0002',
    target: '/api/mcp',
    model: 'live-model-x',
    category: 'ASI02',
    trace,
    verdict: compromised
      ? {
          runId: 'live-run-0002',
          compromised: true,
          score: 0.91,
          severity: 'High',
          category: 'ASI02',
          rationale: 'The agent read a path outside the declared scope.',
          stepId: offending,
        }
      : {
          runId: 'live-run-0002',
          compromised: false,
          score: 0.04,
          severity: 'None',
          category: 'ASI02',
          rationale: 'The agent stayed inside the declared scope and refused the traversal.',
        },
  });
}

function stored(run: RunResult): StoredRun {
  return {
    id: 'row-uuid-9876',
    userId: 'user-1',
    createdAt: '2026-08-05T09:41:07.123456+00:00',
    run,
  };
}

function repoWith(rows: StoredRun[]) {
  return {
    saveRun: vi.fn(),
    listRuns: vi.fn(),
    countRunsSince: vi.fn(),
    findByRunId: vi.fn(),
    getRun: vi.fn(
      async (userId: string, id: string) =>
        rows.find((r) => r.id === id && r.userId === userId) ?? null,
    ),
  };
}

const renderPage = async (id: string) =>
  render(await RunReplayPage({ params: Promise.resolve({ id }) }));

/** Sign in as the owner of one persisted run. */
function signedInWith(run: RunResult) {
  asMock(getUser).mockResolvedValue({ id: 'user-1' } as never);
  asMock(getRunRepository).mockResolvedValue(repoWith([stored(run)]));
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(getUser).mockResolvedValue(null);
  asMock(getRunRepository).mockResolvedValue(repoWith([]));
});

describe('Live Attack Replay — the sample run', () => {
  it('plays the sample with no sign-in, under its exact recorded provenance label', async () => {
    await renderPage('sample');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ASI02');
    expect(screen.getByText(SAMPLE_VERDICT_PROVENANCE)).toBeInTheDocument();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('resolves the canonical sample id as well as the alias', async () => {
    await renderPage(SAMPLE_RUN_ID);
    expect(screen.getByRole('list', { name: /step timeline/i })).toBeInTheDocument();
  });
});

describe('Live Attack Replay — a persisted live run', () => {
  it('renders the RunResult read from the repository, not the sample', async () => {
    signedInWith(liveRun(true));
    await renderPage('row-uuid-9876');

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('ASI02');
    expect(heading).not.toHaveTextContent('ASI06');
    // The trace on screen is this run's: one line per step, its own model prompt.
    const timeline = screen.getByRole('list', { name: /step timeline/i });
    expect(within(timeline).getAllByRole('button')).toHaveLength(3);
    // And the fix-report off-ramp points at THIS run, by the STORED ROW id in the
    // URL. `/findings/[id]` resolves a row id, and the live session run id on the
    // verdict is a different string that resolves to nothing there.
    expect(screen.getByRole('link', { name: /export fix report/i })).toHaveAttribute(
      'href',
      '/findings/row-uuid-9876',
    );
  });

  it('labels a live verdict as a live run, never as the constructed demonstration', async () => {
    signedInWith(liveRun(true));
    await renderPage('row-uuid-9876');
    expect(screen.getByText(/live run/i)).toBeInTheDocument();
    expect(screen.queryByText(SAMPLE_VERDICT_PROVENANCE)).not.toBeInTheDocument();
  });

  it('states the compromise and the step it is anchored to', async () => {
    signedInWith(liveRun(true));
    await renderPage('row-uuid-9876');
    expect(screen.getByTestId('run-outcome')).toHaveTextContent(/compromised at step 2/i);
  });

  /**
   * THE CLEAN-RESISTANCE RESULT IS A FIRST-CLASS OUTCOME, and it is tested as an
   * equal peer of the compromised path: a real replay of a real run that says the
   * agent resisted. Never an empty state, never an error, never a spinner.
   */
  it('renders a run the agent resisted as a successful result, with no findings claimed', async () => {
    signedInWith(liveRun(false));
    await renderPage('row-uuid-9876');

    expect(screen.getByTestId('run-outcome')).toHaveTextContent(/agent resisted/i);
    // The whole replay is there: the transcript, the transport, the verdict.
    expect(screen.getByRole('list', { name: /step timeline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Play$/ })).toBeInTheDocument();
    const verdict = screen.getByRole('complementary', { name: /detector verdict/i });
    expect(within(verdict).getByText('NOT COMPROMISED')).toBeInTheDocument();
    // Nothing is badged as the compromise, because there is no compromise.
    expect(screen.queryByRole('button', { name: /compromise step/i })).not.toBeInTheDocument();
    // And it is NOT the not-found state.
    expect(screen.queryByText(/no run to replay/i)).not.toBeInTheDocument();
  });

  it('points a resisted run at its own run result, by the row id in the URL', async () => {
    signedInWith(liveRun(false));
    await renderPage('row-uuid-9876');
    // The session run id would land a clean run on the missing-report state,
    // which reads as something going wrong for a run that went right.
    expect(screen.getByRole('link', { name: /export run result/i })).toHaveAttribute(
      'href',
      '/findings/row-uuid-9876',
    );
  });
});

describe('Live Attack Replay — an id that resolves to nothing', () => {
  it('states plainly that there is no such run, and never substitutes the sample', async () => {
    asMock(getUser).mockResolvedValue({ id: 'user-1' } as never);
    await renderPage('no-such-run');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/no run to replay/i);
    expect(screen.getByText('no-such-run')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sample run/i })).toBeInTheDocument();
    // Showing someone the ASI06 demonstration under their own run id would be
    // presenting a constructed demonstration as their result.
    expect(screen.queryByText(SAMPLE_VERDICT_PROVENANCE)).not.toBeInTheDocument();
  });

  it('shows another account run as not found, never as a run you can read', async () => {
    const other: StoredRun = { ...stored(liveRun(true)), userId: 'someone-else' };
    asMock(getUser).mockResolvedValue({ id: 'user-1' } as never);
    asMock(getRunRepository).mockResolvedValue(repoWith([other]));

    await renderPage('row-uuid-9876');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/no run to replay/i);
  });
});
