/**
 * WHERE SIGN-IN MAY SEND SOMEONE BACK TO.
 *
 * `next` arrives from the untrusted `?next=` query param, so it is only ever a
 * same-site relative path: it starts with one slash, never two (a
 * protocol-relative URL), and holds no backslash (which some browsers read as a
 * slash). Anything else is not a destination.
 *
 * One rule, used on both sides of the trip: the links that build a `next`
 * (the shell's sign-in entry) and the action that follows one after sign-in.
 */
export function isSafeNext(next: string | undefined | null): next is string {
  return !!next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\');
}

/** A safe `next`, else `/account` (open-redirect guard). */
export function sanitizeNext(next?: string): string {
  return isSafeNext(next) ? next : '/account';
}
