import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseConfig } from '@/config/env';
import {
  CSP_REPORT_ONLY_HEADER,
  buildContentSecurityPolicy,
  mintNonce,
} from '@/config/security-headers';
import { updateSession } from '@/lib/supabase/middleware';
import { MISSING_RUN_PATHS, couldBeRunId } from '@/lib/run-id';
import { SHELL_USER_HEADER } from '@/lib/shell-identity';

/**
 * Four jobs per request: (1) expose the pathname to Server Components via an
 * `x-pathname` header so the command deck computes its active link server-side
 * (no client `usePathname`, fast LCP), (2) answer a run id that cannot be a run
 * with a server-rendered 404, (3) refresh the Supabase session so SSR auth
 * stays valid, and (4) send the report-only content security policy with a
 * nonce minted for this request (see `contentSecurityPolicy` below).
 * `updateSession` carries the headers through and is a passthrough when auth is
 * not configured (offline-safe).
 *
 * `x-pathname` is SET, never appended: a request that arrives carrying a header
 * of that name has it replaced with the real path. The shell user header is
 * handled the same way: cleared here, written by `updateSession`.
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

/**
 * THE CONTENT SECURITY POLICY, REPORT-ONLY, WITH A NONCE PER REQUEST.
 *
 * The static security headers come from `next.config.ts`. This one cannot: its
 * nonce has to be new for every response. The policy is put in two places. On
 * the REQUEST, because that is where Next reads the nonce it stamps on the
 * script tags it renders (it looks at `content-security-policy` first, then at
 * the report-only name). On the RESPONSE, for the browser.
 *
 * Report-only: the browser reports what it would have blocked and blocks
 * nothing. The policy itself is built in `src/config/security-headers.ts`.
 *
 * Nothing under `/api` or `/_next/static` reaches this function (see the
 * matcher), so the MCP endpoint is never given a policy and its responses are
 * never touched here.
 */
function contentSecurityPolicy(): string {
  return buildContentSecurityPolicy({
    nonce: mintNonce(),
    supabaseOrigin: supabaseUrl(),
    development: process.env.NODE_ENV === 'development',
  });
}

/** The configured Supabase URL, or `null` when there is none or it cannot be read. */
function supabaseUrl(): string | null {
  try {
    return getSupabaseConfig()?.url ?? null;
  } catch {
    // A bad Supabase config is reported where auth is used. It must not take
    // the 404 pages down with it here.
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const policy = contentSecurityPolicy();
  const response = await respond(request, policy);
  response.headers.set(CSP_REPORT_ONLY_HEADER, policy);
  return response;
}

async function respond(request: NextRequest, policy: string): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  // The shell's "signed in as" label reads this header. Whatever the client
  // sent is dropped here, on every path; `updateSession` writes the verified
  // address back when there is one. Display only (`src/lib/shell-identity.ts`).
  requestHeaders.delete(SHELL_USER_HEADER);
  // The policy is SET, never appended, under the report-only name, and an
  // enforcing one the client sent is dropped: Next would read its nonce first.
  requestHeaders.delete('content-security-policy');
  requestHeaders.set(CSP_REPORT_ONLY_HEADER, policy);

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
