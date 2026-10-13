import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { sanitizeNext } from '@/lib/auth/next';
import { logger } from '@/lib/logger';

/** `path` on `origin`; if it resolves anywhere else, the account page instead. */
function onOrigin(path: string, origin: string): URL {
  const url = new URL(path, origin);
  return url.origin === origin ? url : new URL('/account', origin);
}

/**
 * Auth callback — the return target for the GitHub OAuth redirect, and the only
 * remaining PKCE consumer now that email sign-in is a typed code with no URL to
 * open. Exchanges the one-time `code` for a session (cookies are set by
 * the cookie-bound server client) and forwards to `next` (default `/account`).
 * `next` is untrusted, so it goes through `sanitizeNext`, the one open-redirect
 * guard, and the destination is then resolved with `new URL` and checked to be
 * on the request's own origin before anything is sent. It is never joined onto
 * the origin as text: origin plus `@host` is a URL on another site. On
 * any failure it bounces to the sign-in page with an error marker rather than
 * leaving the user on a blank callback.
 *
 * The failure branch is instrumented (secret-safe) so a bounced sign-in is
 * diagnosable from logs: whether a `?code` arrived, whether the PKCE
 * `code_verifier` cookie was present on THIS request (a same-site `lax` cookie —
 * absent iff the link was opened in a different browser/app than it was
 * requested from), and the provider/exchange error text. No code or token value
 * is ever logged.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = sanitizeNext(searchParams.get('next'));
  const providerError = searchParams.get('error');
  const hasVerifier = /-auth-token-code-verifier=/.test(request.headers.get('cookie') ?? '');

  if (code) {
    const supabase = await createServerSupabase();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(onOrigin(next, origin));
      logger.warn('auth callback: code exchange failed', {
        hasCode: true,
        hasVerifier,
        exchangeError: error.message,
      });
      return NextResponse.redirect(`${origin}/sign-in?error=auth`);
    }
  }

  logger.warn('auth callback: no session established', {
    hasCode: Boolean(code),
    hasVerifier,
    providerError: providerError ?? undefined,
  });
  return NextResponse.redirect(`${origin}/sign-in?error=auth`);
}
