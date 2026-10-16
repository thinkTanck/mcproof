import { render, screen } from '@testing-library/react';
import NotFound from '@/app/not-found';

// The 404 is a bare console that echoes the requested path via the middleware
// x-pathname header, so it reads that header the way AppShell does.
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k === 'x-pathname' ? '/ghost/route' : null) }),
}));

/**
 * Custom 404. It renders without the command deck, so its whole job is to name
 * the dead end and carry the user back into the app — the heading + the
 * wayfinding links are the contract worth locking.
 */
describe('NotFound (custom 404)', () => {
  it('names the dead end with a page heading', async () => {
    render(await NotFound());
    expect(screen.getByRole('heading', { level: 1, name: /page not found/i })).toBeInTheDocument();
  });

  it('echoes the requested path from the x-pathname header', async () => {
    render(await NotFound());
    expect(screen.getByText(/resolve \/ghost\/route/i)).toBeInTheDocument();
  });

  it('carries wayfinding back into the app (home, sample, connect)', async () => {
    render(await NotFound());
    const nav = screen.getByRole('navigation', { name: /where to next/i });
    const links = Object.fromEntries(
      screen.getAllByRole('link').map((a) => [a.getAttribute('href'), a] as const),
    );
    expect(nav).toBeInTheDocument();
    expect(links['/']).toBeTruthy();
    expect(links['/runs/sample']).toBeTruthy();
    expect(links['/connect']).toBeTruthy();
  });
});
