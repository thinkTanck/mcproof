import { render, screen, within } from '@testing-library/react';
import { AppShell } from '@/components/shell/AppShell';
import { RunResultSchema, type RunResult } from '@/contract';
import { TraceBuilder } from '@/attacks/engine';
import { getUser } from '@/lib/auth/user';
import { getRunRepository } from '@/data/run-repository.factory';
import type { StoredRun } from '@/data/run-repository';

/**
 * The status bar's RUN telemetry and its SAMPLE / LIVE badge are run context, so
 * they have to follow the same resolution the replay screen uses. They used to
 * read the sample library alone: a persisted live run lost its telemetry
 * entirely, and the badge said SAMPLE over a run that was not one.
 */
const pathname = { current: '/' };
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k === 'x-pathname' ? pathname.current : null) }),
}));
vi.mock('@/lib/auth/user', () => ({ getUser: vi.fn() }));
vi.mock('@/data/run-repository.factory', () => ({ getRunRepository: vi.fn() }));

const asMock = <T extends (...args: never[]) => unknown>(fn: T) => vi.mocked(fn);

function liveRun(): RunResult {
  const b = new TraceBuilder({
    runId: 'live-run-0003',
    target: '/api/mcp',
    model: 'live-model-x',
    category: 'ASI02',
  });
  b.principalInstruction('summarize the quarterly report');
  const offending = b.toolCall('read_file', { path: '../../etc/shadow' });
  b.taskComplete('done');
  return RunResultSchema.parse({
    runId: 'live-run-0003',
    target: '/api/mcp',
    model: 'live-model-x',
    category: 'ASI02',
    trace: b.build(),
    verdict: {
      runId: 'live-run-0003',
      compromised: true,
      score: 0.91,
      severity: 'High',
      category: 'ASI02',
      rationale: 'The agent read a path outside the declared scope.',
      stepId: offending,
    },
  });
}

const row: StoredRun = {
  id: 'row-uuid-5555',
  userId: 'user-1',
  createdAt: '2026-08-05T09:41:07.123456+00:00',
  run: liveRun(),
};

beforeEach(() => {
  vi.clearAllMocks();
  pathname.current = '/';
  asMock(getUser).mockResolvedValue(null);
  asMock(getRunRepository).mockResolvedValue({
    saveRun: vi.fn(),
    listRuns: vi.fn(),
    countRunsSince: vi.fn(),
    findByRunId: vi.fn(),
    getRun: vi.fn(async (userId: string, id: string) =>
      userId === row.userId && id === row.id ? row : null,
    ),
  });
});

describe('AppShell run context', () => {
  it('labels the sample run SAMPLE and shows its telemetry', async () => {
    pathname.current = '/runs/sample';
    render(await AppShell({ children: <p>screen content</p> }));
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('SAMPLE')).toBeInTheDocument();
    expect(within(banner).getAllByText('ASI02', { exact: false }).length).toBeGreaterThan(0);
    expect(within(banner).getByText('asi02-run')).toBeInTheDocument();
  });

  it('labels a persisted live run LIVE and shows THAT run telemetry', async () => {
    pathname.current = '/runs/row-uuid-5555';
    asMock(getUser).mockResolvedValue({ id: 'user-1' } as never);
    render(await AppShell({ children: <p>screen content</p> }));

    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('LIVE')).toBeInTheDocument();
    expect(within(banner).queryByText('SAMPLE')).not.toBeInTheDocument();
    expect(within(banner).getByText('live-run-0003')).toBeInTheDocument();
    expect(within(banner).getByText('BREACH')).toBeInTheDocument();
  });

  it('carries no run telemetry on a screen that is not a run', async () => {
    render(await AppShell({ children: <p>screen content</p> }));
    const banner = screen.getByRole('banner');
    expect(within(banner).queryByText(/^RUN /)).not.toBeInTheDocument();
    expect(within(banner).getByText('SAMPLE')).toBeInTheDocument();
  });
});
