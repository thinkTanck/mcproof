import { asiLabel } from '@/lib/owasp/asi';
import { render, screen } from '@testing-library/react';
import AccountPage from '@/app/(hud)/account/page';
import { requireUser } from '@/lib/auth/user';
import { getRunRepository } from '@/data/run-repository.factory';
import { getDataSource } from '@/data/source';

vi.mock('@/lib/auth/user', () => ({ requireUser: vi.fn() }));
vi.mock('@/data/run-repository.factory', () => ({ getRunRepository: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ signOut: vi.fn() }));

const asUser = () =>
  vi.mocked(requireUser).mockResolvedValue({ id: 'u1', email: 'a@b.com' } as never);
const withRuns = (runs: unknown[]) =>
  vi.mocked(getRunRepository).mockResolvedValue({ listRuns: async () => runs } as never);

describe('Account page (gated · your runs)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the user, an empty state, sign-out, and a Connect CTA when there are no runs', async () => {
    asUser();
    withRuns([]);
    render(await AccountPage());

    expect(screen.getByRole('heading', { level: 1, name: /your runs/i })).toBeInTheDocument();
    expect(screen.getByText('a@b.com')).toBeInTheDocument();
    expect(screen.getByText(/no runs yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /connect your agent/i })).toHaveAttribute(
      'href',
      '/connect',
    );
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('lists the user’s runs (owner-scoped, bound to the RunResult)', async () => {
    const run = await getDataSource().getRun('sample');
    if (!run) throw new Error('sample run missing');
    asUser();
    withRuns([{ id: 'r1', userId: 'u1', createdAt: '2026-01-01T00:00:00Z', run }]);
    render(await AccountPage());

    // A code is never drawn without its name (UI audit 2026-10-12, batch C).
    expect(screen.getByText(asiLabel(run.category))).toBeInTheDocument();
    expect(screen.getByText('COMPROMISED')).toBeInTheDocument();
    expect(screen.queryByText(/no runs yet/i)).not.toBeInTheDocument();
  });

  it('opens each run in the replay, by its ROW id (the address a run is fetched by)', async () => {
    const run = await getDataSource().getRun('sample');
    if (!run) throw new Error('sample run missing');
    asUser();
    withRuns([{ id: 'r1', userId: 'u1', createdAt: '2026-01-01T00:00:00Z', run }]);
    render(await AccountPage());

    // A stored run the user cannot open is a run that was persisted for nobody.
    // The row id is the link, not `RunResult.runId` (which is not unique per user).
    expect(screen.getByRole('link', { name: /replay/i })).toHaveAttribute('href', '/runs/r1');
  });
});
