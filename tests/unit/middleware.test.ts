// @vitest-environment node
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

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
