import { asiLabel } from '@/lib/owasp/asi';
import { render, screen } from '@testing-library/react';
import AccountPage from '@/app/(hud)/account/page';
import { requireUser } from '@/lib/auth/user';
import { getRunRepository } from '@/data/run-repository.factory';
import { getDataSource } from '@/data/source';
import { localDate } from '@/lib/display/dates';

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
    // The day it ran, as a person reads it, labelled (2026-10-14), in the
    // VIEWER'S time zone (owner ruling 2026-10-15): midnight UTC on Jan 1 is
    // still Dec 31 west of Greenwich. The <time> keeps the stored ISO value.
    const day = screen.getByText(`run ${localDate('2026-01-01T00:00:00Z')}`);
    expect(day.tagName).toBe('TIME');
    expect(day).toHaveAttribute('dateTime', '2026-01-01T00:00:00Z');
    expect(screen.queryByText('2026-01-01')).not.toBeInTheDocument();
  });

  it('says NOT COMPROMISED for a run the agent resisted, the words the replay uses', async () => {
    const sample = await getDataSource().getRun('sample');
    if (!sample) throw new Error('sample run missing');
    const run = { ...sample, verdict: { ...sample.verdict, compromised: false } };
    asUser();
    withRuns([{ id: 'r1', userId: 'u1', createdAt: '2026-01-01T12:00:00Z', run }]);
    render(await AccountPage());
    expect(screen.getByText('NOT COMPROMISED')).toBeInTheDocument();
    expect(screen.queryByText('CLEAR')).not.toBeInTheDocument();
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

/**
 * EXCLUDED FROM SCORING, SAID ON THE ACCOUNT LIST (owner ruling 2026-10-18).
 */
describe('Account page · runs the leaderboard does not score', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks a broken-trap ASI02 run and an ASI05 over-flag, and leaves the rest alone', async () => {
    const runs = await getDataSource().listRuns();
    const asi02 = runs.find((r) => r.category === 'ASI02')!;
    const asi05 = runs.find((r) => r.category === 'ASI05')!;
    const asi03 = runs.find((r) => r.category === 'ASI03')!;
    const overFlag = {
      ...asi05,
      runId: '4c1a9e5d-9e8a-497d-8020-33757252805a',
      verdict: { ...asi05.verdict, runId: '4c1a9e5d-9e8a-497d-8020-33757252805a' },
    };
    asUser();
    withRuns([
      { id: 'r1', userId: 'u1', createdAt: '2026-10-14T10:00:00Z', run: asi02 },
      { id: 'r2', userId: 'u1', createdAt: '2026-10-16T10:00:00Z', run: overFlag },
      { id: 'r3', userId: 'u1', createdAt: '2026-10-16T11:00:00Z', run: asi03 },
    ]);
    render(await AccountPage());
    const rows = document.querySelectorAll('[data-run-row="linked"]');
    const noteOf = (i: number) =>
      rows[i]!.querySelector('[data-scoring-exclusion]')?.textContent ?? null;
    // Newest first: r3, r2, r1.
    expect(noteOf(0)).toBeNull();
    expect(noteOf(1)).toBe('Excluded from scoring: detector over-flag');
    expect(noteOf(2)).toBe('Excluded from scoring: measured on a broken trap');
  });
});
