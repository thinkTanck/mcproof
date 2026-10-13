import { GET } from '@/app/auth/callback/route';
import { sanitizeNext } from '@/lib/auth/next';
import { createServerSupabase } from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn() }));
// The real guard, wrapped so one test can make it misbehave.
vi.mock('@/lib/auth/next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/next')>();
  return { ...actual, sanitizeNext: vi.fn(actual.sanitizeNext) };
});

const ORIGIN = 'https://mcproof.test';

const withExchange = (result: { error: unknown }) =>
  vi.mocked(createServerSupabase).mockResolvedValue({
    auth: { exchangeCodeForSession: vi.fn().mockResolvedValue(result) },
  } as never);

/** A callback request whose query string is written out exactly as given. */
const callback = (query: string) => new Request(`${ORIGIN}/auth/callback${query}`);

/**
 * Every hostile `next`, as the RAW query value an attacker would put in the link.
 * `searchParams.get` decodes it once, so `%2F%2Fevil.example` reaches the route as
 * `//evil.example` and the double-encoded form reaches it as `%2F%2Fevil.example`.
 */
const HOSTILE: Array<[label: string, rawQueryValue: string]> = [
  ['@evil.example', '@evil.example'],
  ['@evil.example, encoded', '%40evil.example'],
  ['//evil.example', '//evil.example'],
  ['//evil.example, encoded', '%2F%2Fevil.example'],
  ['//evil.example, double-encoded', '%252F%252Fevil.example'],
  ['https://evil.example', 'https://evil.example'],
  ['https://evil.example, encoded', 'https%3A%2F%2Fevil.example'],
  ['https://evil.example, double-encoded', 'https%253A%252F%252Fevil.example'],
  ['slash backslash', '/\\evil.example'],
  ['slash backslash, encoded', '%2F%5Cevil.example'],
  ['slash backslash, double-encoded', '%252F%255Cevil.example'],
  ['backslash slash', '\\/evil.example'],
  ['backslash slash, encoded', '%5C%2Fevil.example'],
  ['two backslashes', '\\\\evil.example'],
  ['two backslashes, encoded', '%5C%5Cevil.example'],
  ['javascript:alert(1)', 'javascript:alert(1)'],
  ['javascript:alert(1), encoded', 'javascript%3Aalert(1)'],
  ['a tab between two slashes', '/%09/evil.example'],
  ['a newline between two slashes', '/%0A/evil.example'],
  ['a carriage return between two slashes', '/%0D/evil.example'],
  ['a leading tab', '%09//evil.example'],
  ['dot segments collapsing to a double slash', '/..//evil.example'],
  ['dot segments collapsing to a double slash, encoded', '%2F..%2F%2Fevil.example'],
  ['an absolute URL to this very site', `${ORIGIN}/runs/abc`],
  ['an empty string', ''],
  ['a very long path', `/${'a'.repeat(5000)}`],
  ['a very long hostile value', `//evil.example/${'a'.repeat(5000)}`],
];

describe('auth callback route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exchanges the code and redirects to next (default /account)', async () => {
    withExchange({ error: null });
    const res = await GET(callback('?code=abc'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/account`);
  });

  it('honours an explicit next target', async () => {
    withExchange({ error: null });
    const res = await GET(callback('?code=abc&next=/leaderboard'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/leaderboard`);
  });

  it('bounces to sign-in when the code is missing', async () => {
    const res = await GET(callback(''));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=auth`);
  });

  it('bounces to sign-in when the exchange fails', async () => {
    withExchange({ error: { message: 'bad code' } });
    const res = await GET(callback('?code=abc'));
    expect(res.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=auth`);
  });

  describe('next cannot leave the site (open-redirect guard)', () => {
    it.each(HOSTILE)('sends next = %s to /account on this origin', async (_label, raw) => {
      withExchange({ error: null });
      const res = await GET(callback(`?code=abc&next=${raw}`));
      const location = new URL(res.headers.get('location') ?? '');
      expect(location.origin).toBe(ORIGIN);
      expect(location.href).toBe(`${ORIGIN}/account`);
    });

    it.each([
      ['/runs/abc', '/runs/abc', '/runs/abc'],
      ['/runs/abc, encoded', '%2Fruns%2Fabc', '/runs/abc'],
      [
        '/runs/abc with a query and a hash',
        '%2Fruns%2Fabc%3Ftab%3Dreport%23step-3',
        '/runs/abc?tab=report#step-3',
      ],
      ['/', '/', '/'],
      ['a path that only looks like a host', '/@evil.example', '/@evil.example'],
      [
        'a double slash that stays encoded inside the path',
        '%2F%252F%252Fevil.example',
        '/%2F%2Fevil.example',
      ],
    ])('preserves next = %s', async (_label, raw, expected) => {
      withExchange({ error: null });
      const res = await GET(callback(`?code=abc&next=${raw}`));
      const location = new URL(res.headers.get('location') ?? '');
      expect(location.origin).toBe(ORIGIN);
      expect(location.href).toBe(`${ORIGIN}${expected}`);
    });

    it('still stays on this origin if the guard itself ever let a host through', async () => {
      withExchange({ error: null });
      vi.mocked(sanitizeNext).mockReturnValueOnce('//evil.example');
      const res = await GET(callback('?code=abc&next=/runs/abc'));
      expect(res.headers.get('location')).toBe(`${ORIGIN}/account`);
    });

    it.each([
      ['no code', '?next=//evil.example'],
      ['no code, userinfo form', '?next=@evil.example'],
      ['a provider error', '?error=access_denied&next=https://evil.example'],
    ])('does not echo next on the failure branch: %s', async (_label, query) => {
      const res = await GET(callback(query));
      expect(res.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=auth`);
    });

    it('does not echo next when the exchange fails', async () => {
      withExchange({ error: { message: 'bad code' } });
      const res = await GET(callback('?code=abc&next=@evil.example'));
      expect(res.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=auth`);
    });

    it('does not echo next when auth is not configured', async () => {
      vi.mocked(createServerSupabase).mockResolvedValue(null as never);
      const res = await GET(callback('?code=abc&next=//evil.example'));
      expect(res.headers.get('location')).toBe(`${ORIGIN}/sign-in?error=auth`);
    });
  });
});
