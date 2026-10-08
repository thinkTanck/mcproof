/**
 * WHO THE SHELL SAYS IS SIGNED IN. A LABEL, NEVER A PERMISSION.
 *
 * The middleware asks Supabase who the visitor is on every page request, to keep
 * the session fresh. It forwards the verified address to the server render as a
 * request header, so the shell can print "signed in as ..." without a second
 * round trip to the auth server on every page.
 *
 * ── DISPLAY ONLY ──
 *
 * Nothing may decide what a visitor is ALLOWED to see or do from this value.
 * That is `getUser()` / `requireUser()` (`src/lib/auth/user.ts`), which ask
 * Supabase with the session cookie each time. This module is imported by the
 * middleware, which writes the header, and by `AppShell`, which reads it to draw
 * a label; `tests/unit/shell-identity-guard.test.ts` fails if anything else does.
 *
 * The header is SET by the middleware on every request and a value the client
 * sent is discarded, the same way `x-pathname` is handled.
 */

import type { ShellAccount } from './shell-account';

/** Named for what it is for, so it does not read as something to trust. */
export const SHELL_USER_HEADER = 'x-shell-user-email';

export type { ShellAccount } from './shell-account';

/**
 * The header value for an address. Encoded because a header carries a limited
 * set of bytes and an address may hold others (a unicode local part, an
 * internationalised domain).
 */
export function encodeShellUser(email: string): string {
  return encodeURIComponent(email);
}

/**
 * What the shell should show, from the request's headers.
 *
 * A value that cannot be decoded, or is blank, is nobody: this never throws,
 * because it runs in the layout of every page.
 */
export function readShellAccount(
  headers: { get(name: string): string | null },
  { authConfigured = true }: { authConfigured?: boolean } = {},
): ShellAccount {
  if (!authConfigured) return { state: 'preview' };
  const raw = headers.get(SHELL_USER_HEADER);
  if (!raw) return { state: 'signed-out' };
  let email: string;
  try {
    email = decodeURIComponent(raw).trim();
  } catch {
    return { state: 'signed-out' };
  }
  return email ? { state: 'signed-in', email } : { state: 'signed-out' };
}
