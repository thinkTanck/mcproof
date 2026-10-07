import { render, screen } from '@testing-library/react';
import { AppShell } from '@/components/shell/AppShell';
import { getUser } from '@/lib/auth/user';
import { getRunRepository } from '@/data/run-repository.factory';

/**
 * THE SHELL SURVIVES AN ID THAT CANNOT BE A ROW ID (sweep 2026-10-07, X3).
 *
 * The header resolves the run on show through the same resolver the screens use,
 * to decide the SAMPLE / LIVE chip. `runs.id` is a uuid column, so for a
 * signed-in visitor a mistyped id made the lookup throw, and it threw in the
 * LAYOUT: no screen-level not-found can catch that. The resolver now answers
 * "no run" for such an id without asking, so the shell draws and states no mode.
 */
const pathname = { current: '/' };
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k === 'x-pathname' ? pathname.current : null) }),
}));
vi.mock('@/lib/auth/user', () => ({ getUser: vi.fn() }));
vi.mock('@/data/run-repository.factory', () => ({ getRunRepository: vi.fn() }));

const asMock = <T extends (...args: never[]) => unknown>(fn: T) => vi.mocked(fn);

/** Fails the way the uuid column does when handed something that is not one. */
const getRun = vi.fn(async (_userId: string, id: string) => {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('getRun failed: invalid input syntax for type uuid');
  }
  return null;
});

beforeEach(() => {
  vi.clearAllMocks();
  asMock(getUser).mockResolvedValue({ id: 'user-1' } as never);
  asMock(getRunRepository).mockResolvedValue({
    saveRun: vi.fn(),
    listRuns: vi.fn(),
    countRunsSince: vi.fn(),
    findByRunId: vi.fn(),
    getRun,
  });
});

describe('AppShell, signed in, on a malformed run id', () => {
  it.each(['/runs/does-not-exist', '/findings/does-not-exist'])(
    '%s: renders without throwing and shows no mode chip',
    async (path) => {
      pathname.current = path;

      render(await AppShell({ children: <p>screen</p> }));

      expect(screen.getByRole('banner')).toBeVisible();
      expect(screen.getByText('screen')).toBeVisible();
      // No run resolved, so no origin to state: neither chip, and a neutral pulse.
      expect(screen.queryByText(/^(SAMPLE|LIVE)$/)).toBeNull();
      expect(document.querySelector('[data-header-pulse]')).toHaveAttribute(
        'data-header-pulse',
        'neutral',
      );
      expect(getRun).not.toHaveBeenCalled();
    },
  );
});
