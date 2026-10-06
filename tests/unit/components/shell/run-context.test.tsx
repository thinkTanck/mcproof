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
  });
});

/**
 * THE MODE CHIP IS PROVENANCE, SO IT ONLY APPEARS WHERE THERE IS A RUN.
 *
 * The chip used to default to SAMPLE, so every screen with no run on it (home,
 * connect, the leaderboard, the threat model, the account page) printed SAMPLE
 * over nothing. A label that says where a run came from has no business on a
 * screen that is not showing one. It now appears on the two run-scoped screens,
 * the replay and the fix report, and says what that run's origin is.
 *
 * Both screens resolve the id through the same resolver the shell uses, so the
 * chrome and the screen cannot disagree about which run is on show.
 */
describe('AppShell mode chip', () => {
  const chip = () => within(screen.getByRole('banner')).queryByText(/^(SAMPLE|LIVE)$/);
  const shell = async (path: string) => {
    pathname.current = path;
    render(await AppShell({ children: <p>screen content</p> }));
  };

  it.each(['/runs/sample', '/findings/sample'])('says SAMPLE on %s', async (path) => {
    await shell(path);

    expect(chip()).toHaveTextContent('SAMPLE');
  });

  it.each(['/runs/row-uuid-5555', '/findings/row-uuid-5555'])(
    'says LIVE on %s, a run of the signed-in account',
    async (path) => {
      asMock(getUser).mockResolvedValue({ id: 'user-1' } as never);
      await shell(path);

      expect(chip()).toHaveTextContent('LIVE');
    },
  );

  it.each(['/', '/connect', '/leaderboard', '/threats', '/account'])(
    'renders no chip on %s, which shows no run',
    async (path) => {
      await shell(path);

      expect(chip()).not.toBeInTheDocument();
    },
  );

  it.each(['/runs/no-such-run', '/findings/no-such-run'])(
    'renders no chip on %s, an id that resolves to nothing',
    async (path) => {
      await shell(path);

      expect(chip()).not.toBeInTheDocument();
    },
  );

  it('does not treat a live run as live for someone who does not own it', async () => {
    asMock(getUser).mockResolvedValue({ id: 'someone-else' } as never);
    await shell('/findings/row-uuid-5555');

    expect(chip()).not.toBeInTheDocument();
  });
});
