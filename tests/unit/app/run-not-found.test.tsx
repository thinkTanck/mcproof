import { render, screen } from '@testing-library/react';
import RunNotFound from '@/app/(hud)/runs/[id]/not-found';
import ReportNotFound from '@/app/(hud)/findings/[id]/not-found';
import { getUser } from '@/lib/auth/user';
import { getRunRepository } from '@/data/run-repository.factory';

/**
 * THE 404 BODY IS THE EMPTY STATE THE SCREENS ALREADY HAD.
 *
 * A route-level `not-found.tsx` takes no props, so it cannot be handed the id.
 * It reads the path the visitor asked for from the `x-pathname` request header,
 * the same header the root not-found page and the shell already read.
 *
 * That is its ONLY input. It does not look the run up, so the body it draws for
 * an id that never existed and for a run on someone else's account is the same
 * text by construction.
 */

const path = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (name: string) => (name === 'x-pathname' ? path.current : null),
  }),
}));
vi.mock('@/lib/auth/user', () => ({ getUser: vi.fn() }));
vi.mock('@/data/run-repository.factory', () => ({ getRunRepository: vi.fn() }));

describe('/runs/[id] not-found: the replay empty state', () => {
  it('keeps the empty-state copy and names the id from the path', async () => {
    path.current = '/runs/does-not-exist';
    render(await RunNotFound());

    expect(screen.getByRole('heading', { level: 1, name: 'No run to replay.' })).toBeVisible();
    expect(screen.getByText('does-not-exist')).toBeVisible();
    expect(screen.getByText(/It may be an unfinished run, a run on another account/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Play the sample run' })).toHaveAttribute(
      'href',
      '/runs/sample',
    );
  });

  it('decodes an encoded id and never renders markup from it', async () => {
    path.current = '/runs/%3Cb%3Ex%3C%2Fb%3E';
    const { container } = render(await RunNotFound());

    expect(screen.getByText('<b>x</b>')).toBeVisible();
    expect(container.querySelector('b')).toBeNull();
  });

  it('survives a path it cannot decode', async () => {
    path.current = '/runs/%E0%A4%A';
    render(await RunNotFound());

    expect(screen.getByRole('heading', { level: 1, name: 'No run to replay.' })).toBeVisible();
  });
});

describe('/findings/[id] not-found: the report empty state', () => {
  it('keeps the empty-state copy and names the id from the path', async () => {
    path.current = '/findings/does-not-exist';
    render(await ReportNotFound());

    expect(
      screen.getByRole('heading', { level: 1, name: 'No report for run does-not-exist' }),
    ).toBeVisible();
    expect(screen.getByText(/This run has no fix report/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });
});

describe('the 404 body cannot reveal whether a run exists', () => {
  it.each([
    ['/runs/[id]', RunNotFound, '/runs/3f2b6c1e-8a4d-4c1b-9e57-0a1b2c3d4e5f'],
    ['/findings/[id]', ReportNotFound, '/findings/3f2b6c1e-8a4d-4c1b-9e57-0a1b2c3d4e5f'],
  ] as const)('%s reads the path and nothing else', async (_route, NotFound, pathname) => {
    path.current = pathname;
    render(await NotFound());

    // No session read and no run lookup: with one input, the body for a real
    // run on another account and for an id nobody has is the same text.
    expect(getUser).not.toHaveBeenCalled();
    expect(getRunRepository).not.toHaveBeenCalled();
  });
});
