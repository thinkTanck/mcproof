// @vitest-environment node
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { SAMPLE_RUN_IDS } from '@/lib/run-id';

/**
 * `x-pathname` IS OURS, NEVER THE CLIENT'S.
 *
 * Server Components read the requested path from this header: the shell for its
 * active link, and the not-found pages for the id they name. A request can
 * arrive already carrying a header of that name, so the middleware has to
 * replace it, not merely add one when it is missing. If it did not, a caller
 * could make a 404 page print a path of their choosing.
 *
 * `NextResponse.next({ request: { headers } })` reports the forwarded request
 * headers on the response as `x-middleware-request-<name>`, which is what is
 * read here.
 */
vi.mock('@/config/env', async (original) => ({
  ...(await original<typeof import('@/config/env')>()),
  // Auth not configured: the passthrough branch, with no network.
  getSupabaseConfig: () => null,
}));

const forwarded = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`);

describe('middleware: x-pathname', () => {
  it('sets it from the real URL', async () => {
    const response = await middleware(new NextRequest('http://localhost/runs/does-not-exist'));

    expect(forwarded(response, 'x-pathname')).toBe('/runs/does-not-exist');
  });

  it('overwrites one the client sent', async () => {
    const response = await middleware(
      new NextRequest('http://localhost/runs/does-not-exist', {
        headers: { 'x-pathname': '/runs/chosen-by-the-caller' },
      }),
    );

    expect(forwarded(response, 'x-pathname')).toBe('/runs/does-not-exist');
    expect(response.headers.get('x-middleware-override-headers')).toContain('x-pathname');
  });

  it('carries the path only, never the query string', async () => {
    const response = await middleware(new NextRequest('http://localhost/runs/abc?x=/runs/other'));

    expect(forwarded(response, 'x-pathname')).toBe('/runs/abc');
  });
});

/**
 * AN ID THAT CANNOT BE A RUN IS ANSWERED HERE, WITH A 404 (PR #188, option B).
 *
 * A page that calls notFound() cannot be server-rendered in Next 16.3.7: the
 * visitor gets an empty document and the copy arrives with the script. A rewrite
 * to a real page with status 404 can. So an id that is neither a sample id nor
 * shaped like a row id is rewritten here, on a string check alone: no session
 * read, no database call. Everything that might be a run goes on to the page.
 */
const rewrittenTo = (response: Response) => {
  const target = response.headers.get('x-middleware-rewrite');
  return target === null ? null : new URL(target).pathname;
};
const at = (path: string) => middleware(new NextRequest(`http://localhost${path}`));

describe('middleware: ids that cannot be a run', () => {
  it.each([
    ['/runs/does-not-exist', '/missing/run'],
    ['/runs/no-such-run', '/missing/run'],
    ['/runs/sample-', '/missing/run'],
    ['/runs/SAMPLE', '/missing/run'],
    ['/runs/00000000-0000-4000-8000-00000000000', '/missing/run'], // one digit short
    ['/runs/%3Cb%3Ex%3C%2Fb%3E', '/missing/run'],
    ['/runs/%E0%A4%A', '/missing/run'], // cannot be decoded
    ['/findings/does-not-exist', '/missing/report'],
    ['/findings/does-not-exist/', '/missing/report'],
  ])('%s is rewritten to %s with status 404', async (path, target) => {
    const response = await at(path);

    expect(response.status).toBe(404);
    expect(rewrittenTo(response)).toBe(target);
    // The page it lands on still reads the path the visitor asked for.
    expect(forwarded(response, 'x-pathname')).toBe(new URL(`http://localhost${path}`).pathname);
  });

  it.each(['/missing/run', '/missing/report'])(
    '%s asked for directly is a 404, not a page of its own',
    async (path) => {
      expect((await at(path)).status).toBe(404);
    },
  );
});

describe('middleware: everything else passes through untouched', () => {
  it.each([
    ...SAMPLE_RUN_IDS.flatMap((id) => [`/runs/${id}`, `/findings/${id}`]),
    '/runs/00000000-0000-4000-8000-000000000000',
    '/findings/3F2B6C1E-8A4D-4C1B-9E57-0A1B2C3D4E5F',
    '/runs',
    '/findings',
    '/runs/',
    '/',
    '/connect',
    '/leaderboard',
    '/threats',
    '/sign-in',
    '/account',
    '/no-such-route',
    '/runsx/does-not-exist',
    '/runs/sample/extra',
  ])('%s is not rewritten', async (path) => {
    const response = await at(path);

    expect(response.status).toBe(200);
    expect(rewrittenTo(response)).toBeNull();
    expect(forwarded(response, 'x-pathname')).toBe(path);
  });
});
