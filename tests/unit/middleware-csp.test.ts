// @vitest-environment node
import { NextRequest } from 'next/server';
import {
  CSP_REPORT_ONLY_HEADER,
  buildContentSecurityPolicy,
  nonceOf,
} from '@/config/security-headers';
import { config, middleware } from '@/middleware';

/**
 * THE POLICY IS MINTED PER REQUEST, HERE.
 *
 * A nonce has to be new for every response, so it cannot come from the static
 * header rules in `next.config.ts`. The middleware mints one, sends the policy
 * report-only on the response, and forwards the same policy on the request,
 * which is where Next reads the nonce it puts on its own script tags.
 *
 * `NextResponse.next({ request: { headers } })` reports the forwarded request
 * headers on the response as `x-middleware-request-<name>`, which is what is
 * read here.
 */
const supabase = vi.hoisted(() => ({ config: null as { url: string; anonKey: string } | null }));

vi.mock('@/config/env', async (original) => ({
  ...(await original<typeof import('@/config/env')>()),
  getSupabaseConfig: () => supabase.config,
}));

// With a Supabase URL set, the session refresh would open a network client.
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

const forwarded = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`);
const at = (path: string, headers?: Record<string, string>) =>
  middleware(new NextRequest(`http://localhost${path}`, { headers }));

beforeEach(() => {
  supabase.config = null;
});

describe('middleware: the report-only policy', () => {
  it('is on the response, with a nonce', async () => {
    const response = await at('/connect');
    const policy = response.headers.get(CSP_REPORT_ONLY_HEADER);

    expect(policy).not.toBeNull();
    expect(nonceOf(policy ?? '')).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(policy).toBe(buildContentSecurityPolicy({ nonce: nonceOf(policy ?? '') ?? '' }));
  });

  it('is never sent as an enforcing policy', async () => {
    const response = await at('/connect');

    expect(response.headers.get('content-security-policy')).toBeNull();
  });

  it('is forwarded on the request unchanged, so the render uses the same nonce', async () => {
    const response = await at('/connect');

    expect(forwarded(response, 'content-security-policy-report-only')).toBe(
      response.headers.get(CSP_REPORT_ONLY_HEADER),
    );
  });

  it('mints a new nonce for every request', async () => {
    const policies = await Promise.all(
      Array.from({ length: 50 }, async () => (await at('/')).headers.get(CSP_REPORT_ONLY_HEADER)),
    );

    expect(new Set(policies.map((p) => nonceOf(p ?? ''))).size).toBe(50);
  });

  it('drops a policy the client sent, so a caller cannot choose the nonce', async () => {
    const response = await at('/connect', {
      'content-security-policy': "script-src 'nonce-chosen-by-the-caller'",
      'content-security-policy-report-only': "script-src 'nonce-chosen-by-the-caller'",
    });

    expect(forwarded(response, 'content-security-policy')).toBeNull();
    expect(response.headers.get('x-middleware-override-headers')).not.toMatch(
      /(^|,)content-security-policy(,|$)/,
    );
    expect(forwarded(response, 'content-security-policy-report-only')).not.toContain(
      'chosen-by-the-caller',
    );
  });

  it('is on a 404 the middleware answers itself', async () => {
    const response = await at('/runs/does-not-exist');

    expect(response.status).toBe(404);
    expect(nonceOf(response.headers.get(CSP_REPORT_ONLY_HEADER) ?? '')).not.toBeNull();
    expect(forwarded(response, 'content-security-policy-report-only')).toBe(
      response.headers.get(CSP_REPORT_ONLY_HEADER),
    );
  });

  it('names the Supabase origin from config, and none when there is no config', async () => {
    expect((await at('/sign-in')).headers.get(CSP_REPORT_ONLY_HEADER)).toContain(
      "connect-src 'self';",
    );

    supabase.config = { url: 'https://abc.supabase.co', anonKey: 'anon' };

    expect((await at('/sign-in')).headers.get(CSP_REPORT_ONLY_HEADER)).toContain(
      "connect-src 'self' https://abc.supabase.co;",
    );
  });
});

describe('middleware: what it never runs on', () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it.each([
    '/api/mcp/2b1c0e4a-0000-4000-8000-000000000001',
    '/api/health',
    '/_next/static/chunks/a.js',
    '/_next/image',
  ])('%s is outside the matcher, so no nonce work and no wrapping happens there', (path) => {
    expect(matcher.test(path)).toBe(false);
  });

  it.each(['/', '/connect', '/runs/sample', '/nope'])('%s is inside it', (path) => {
    expect(matcher.test(path)).toBe(true);
  });
});
