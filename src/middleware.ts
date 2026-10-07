import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { MISSING_RUN_PATHS, couldBeRunId } from '@/lib/run-id';

/**
 * Three jobs per request: (1) expose the pathname to Server Components via an
 * `x-pathname` header so the command deck computes its active link server-side
 * (no client `usePathname`, fast LCP), (2) answer a run id that cannot be a run
 * with a server-rendered 404, and (3) refresh the Supabase session so SSR auth
 * stays valid. `updateSession` carries the header through and is a passthrough
 * when auth is not configured (offline-safe).
 *
 * `x-pathname` is SET, never appended: a request that arrives carrying a header
 * of that name has it replaced with the real path.
 *
 * ── WHY A 404 IS DECIDED HERE AT ALL ──
 *
 * A page that calls `notFound()` cannot be server-rendered in Next 16.3.7. The
 * HTML render fails at the shell and the recovery render sends an empty
 * `<html id="__next_error__">`, so the copy only appears once script has run.
 * A rewrite to a real page with a 404 status is rendered in full. So for
 * `/runs/<id>` and `/findings/<id>`, an id that is neither a sample id nor
 * shaped like a row id is rewritten to that page here.
 *
 * It is a STRING CHECK ONLY: no session is read and nothing is looked up, so it
 * can say nothing about whether a run exists. Any id that might be a run goes on
 * to the page, which resolves it and answers one way for every id the viewer may
 * not see (issue #189 tracks server-rendering that answer as well).
 */
const RUN_ROUTE = /^\/(runs|findings)\/([^/]+)\/?$/;

/** The id in a path segment, or `null` when it cannot be decoded (and so is no id). */
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);

  const rewriteAs404 = (to: string) =>
    NextResponse.rewrite(new URL(to, request.url), {
      status: 404,
      request: { headers: requestHeaders },
    });

  // The rewrite targets are not pages of their own. Asked for directly, they get
  // the site's ordinary 404.
  if ((Object.values(MISSING_RUN_PATHS) as string[]).includes(pathname.replace(/\/$/, ''))) {
    return rewriteAs404('/_not-found');
  }

  const [, route, segment] = RUN_ROUTE.exec(pathname) ?? [];
  if (route !== undefined && segment !== undefined) {
    const id = decoded(segment);
    if (id === null || !couldBeRunId(id)) {
      return rewriteAs404(MISSING_RUN_PATHS[route as keyof typeof MISSING_RUN_PATHS]);
    }
  }

  return updateSession(request, requestHeaders);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
