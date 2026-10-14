/**
 * WHERE SIGN-IN MAY SEND SOMEONE BACK TO.
 *
 * `next` arrives from the untrusted `?next=` query param, so it is only ever a
 * same-site relative path: it starts with one slash, never two (a
 * protocol-relative URL), and holds no backslash (which some browsers read as a
 * slash). Anything else is not a destination.
 *
 * Three more refusals, each for something a URL parser does AFTER a prefix check
 * has passed:
 *  - a control character anywhere. The parser deletes tabs and newlines, so
 *    slash, tab, slash is read as two slashes and names a host;
 *  - a path that resolves to a leading double slash once its dot segments are
 *    collapsed (`/..//host`), which is a host the next time it is followed;
 *  - anything longer than `MAX_NEXT_LENGTH`, which is no path this site has.
 * The value is also resolved against a placeholder origin and must stay on it.
 *
 * One rule, used on every side of the trip: the links that build a `next` (the
 * shell's sign-in entry), the action that follows one after sign-in, and the
 * OAuth callback route.
 */

/** Longer than any real path here, short enough for every header limit. */
export const MAX_NEXT_LENGTH = 2048;

/** Stands in for the site while a candidate is resolved. Never requested. */
const PROBE_ORIGIN = 'http://next.invalid';

/** C0 controls and DEL: the parser strips some and nothing real contains any. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export function isSafeNext(next: unknown): next is string {
  // A server action argument is whatever the caller sent, and a repeated query
  // key is an array, so the type is checked here and not taken on trust.
  if (typeof next !== 'string' || !next || next.length > MAX_NEXT_LENGTH) return false;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return false;
  if (CONTROL_CHARACTER.test(next)) return false;
  try {
    const url = new URL(next, PROBE_ORIGIN);
    return url.origin === PROBE_ORIGIN && !url.pathname.startsWith('//');
  } catch {
    return false;
  }
}

/** A safe `next`, else `/account` (open-redirect guard). */
export function sanitizeNext(next?: unknown): string {
  return isSafeNext(next) ? next : '/account';
}
