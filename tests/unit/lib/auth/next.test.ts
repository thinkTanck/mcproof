import { isSafeNext, sanitizeNext } from '@/lib/auth/next';

/**
 * `sanitizeNext` is the ONE open-redirect guard: the sign-in action, the OAuth
 * callback and the shell's sign-in link all go through it. Every value below is
 * the string as the guard receives it (after the query string was decoded once).
 */
const ORIGIN = 'https://site.test';

/** What a browser or `new URL` would make of the guard's answer. */
const resolved = (next: string | undefined) => new URL(sanitizeNext(next), ORIGIN);

const HOSTILE: Array<[label: string, value: string]> = [
  ['a userinfo host', '@evil.example'],
  ['a protocol-relative URL', '//evil.example'],
  ['an absolute URL', 'https://evil.example'],
  ['an absolute URL to this very site', `${ORIGIN}/runs/abc`],
  ['slash backslash', '/\\evil.example'],
  ['backslash slash', '\\/evil.example'],
  ['two backslashes', '\\\\evil.example'],
  ['a still-encoded double slash', '%2F%2Fevil.example'],
  ['a script URL', 'javascript:alert(1)'],
  ['a tab between two slashes', '/\t/evil.example'],
  ['a newline between two slashes', '/\n/evil.example'],
  ['a carriage return between two slashes', '/\r/evil.example'],
  ['a leading tab', '\t//evil.example'],
  ['a NUL inside', '/\u0000/evil.example'],
  ['dot segments that collapse to a double slash', '/..//evil.example'],
  ['a deeper collapse to a double slash', '/a/..//evil.example'],
  ['a leading space', ' //evil.example'],
  ['an empty string', ''],
  ['a very long path', `/${'a'.repeat(5000)}`],
  ['a very long hostile value', `//evil.example/${'a'.repeat(5000)}`],
];

describe('sanitizeNext', () => {
  it.each(HOSTILE)('refuses %s and falls back to /account', (_label, value) => {
    expect(isSafeNext(value)).toBe(false);
    expect(sanitizeNext(value)).toBe('/account');
  });

  it.each(HOSTILE)('never resolves %s off the site', (_label, value) => {
    const url = resolved(value);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname.startsWith('//')).toBe(false);
  });

  it.each([undefined, null])('treats a missing next (%s) as /account', (value) => {
    expect(isSafeNext(value)).toBe(false);
    expect(sanitizeNext(value)).toBe('/account');
  });

  it.each([[['/runs/abc', '//evil.example']], [{ href: '/runs/abc' }], [42], [true]])(
    'refuses a value that is not a string (%j)',
    (value) => {
      expect(isSafeNext(value)).toBe(false);
      expect(sanitizeNext(value)).toBe('/account');
    },
  );

  it.each([
    '/',
    '/runs/abc',
    '/runs/abc?tab=report#step-3',
    '/leaderboard',
    '/findings/3f0c8a52-6f1e-4d0b-9c55-0d6f1f1c2a10',
    '/@evil.example',
    '/%2F%2Fevil.example',
    '/connect?run=abc&x=1',
  ])('keeps the same-site path %s exactly', (value) => {
    expect(isSafeNext(value)).toBe(true);
    expect(sanitizeNext(value)).toBe(value);
    expect(resolved(value).origin).toBe(ORIGIN);
  });
});
