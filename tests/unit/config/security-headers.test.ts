// @vitest-environment node
/**
 * RESPONSE SECURITY HEADERS, as data.
 *
 * `src/config/security-headers.ts` is the one place a response header is decided.
 * These tests read it three ways: the header set per route class, the rules
 * `next.config.ts` hands to Next (evaluated with Next's own path matcher, so the
 * exclusions are read the way the router reads them), and the policy string the
 * middleware sends. `tests/e2e/security-headers.spec.ts` proves the same thing on
 * a real server.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import {
  CSP_REPORT_ONLY_HEADER,
  HSTS_VALUE,
  PERMISSIONS_POLICY_VALUE,
  buildContentSecurityPolicy,
  mintNonce,
  nonceOf,
  routeClassOf,
  securityHeaderRules,
  securityHeadersFor,
} from '@/config/security-headers';
import nextConfig from '../../../next.config';

const BASE = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/** The headers the rules give `pathname`, applied the way Next applies them. */
function resolved(pathname: string): { headers: Record<string, string>; setTwice: string[] } {
  const headers: Record<string, string> = {};
  const setTwice: string[] = [];
  for (const rule of securityHeaderRules()) {
    if (!getPathMatch(rule.source, { removeUnnamedParams: true, strict: true })(pathname)) continue;
    for (const { key, value } of rule.headers) {
      if (key in headers) setTwice.push(key);
      headers[key] = value;
    }
  }
  return { headers, setTwice };
}

describe('route classes', () => {
  it.each([
    ['/', 'default'],
    ['/connect', 'default'],
    ['/runs/sample', 'default'],
    ['/api/health', 'default'],
    ['/api/cron/reap-runs', 'default'],
    ['/_next/static/chunks/a.js', 'default'],
    ['/nope', 'default'],
    ['/api/mcp-docs', 'default'],
    ['/api/mcpx/1', 'default'],
    ['/icon.svgx', 'default'],
    ['/api/mcp', 'mcp'],
    ['/api/mcp/', 'mcp'],
    ['/api/mcp/2b1c0e4a-0000-4000-8000-000000000001', 'mcp'],
    ['/api/mcp/a/b', 'mcp'],
    ['/icon.svg', 'public-file'],
    ['/robots.txt', 'public-file'],
    ['/.well-known/security.txt', 'public-file'],
    ['/email/mcproof-logo.png', 'public-file'],
    ['/email/mcproof-logo.pngx', 'default'],
    ['/email/other.png', 'default'],
  ] as const)('%s is %s', (pathname, expected) => {
    expect(routeClassOf(pathname)).toBe(expected);
  });
});

describe('the header set per route class', () => {
  it('gives a page, an API route and an asset the base set plus COOP and CORP same-origin', () => {
    expect(securityHeadersFor('default')).toEqual({
      ...BASE,
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
  });

  it('gives the MCP endpoint the base set and nothing a cross-origin client could trip on', () => {
    const headers = securityHeadersFor('mcp');

    expect(headers).toEqual(BASE);
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toEqual(
      expect.arrayContaining(['cross-origin-opener-policy']),
    );
    expect(headers).not.toHaveProperty('Cross-Origin-Resource-Policy');
    expect(headers).not.toHaveProperty('Content-Security-Policy');
    expect(headers).not.toHaveProperty(CSP_REPORT_ONLY_HEADER);
  });

  it('lets other sites fetch the files that are published for them', () => {
    expect(securityHeadersFor('public-file')).toEqual({
      ...BASE,
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
  });

  it('states HSTS exactly: two years, subdomains, no preload', () => {
    expect(HSTS_VALUE).toBe('max-age=63072000; includeSubDomains');
    expect(HSTS_VALUE).not.toMatch(/preload/i);
  });

  it('denies the five features and leaves the clipboard alone', () => {
    expect(PERMISSIONS_POLICY_VALUE).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    expect(PERMISSIONS_POLICY_VALUE).not.toMatch(/clipboard/i);
  });
});

describe('the rules next.config.ts hands to Next', () => {
  const PATHS = [
    '/',
    '/connect',
    '/sign-in',
    '/runs/sample',
    '/findings/sample',
    '/leaderboard',
    '/threats',
    '/account',
    '/nope',
    '/api/health',
    '/api/cron/reap-runs',
    '/api/mcp-docs',
    '/api/mcpx/1',
    '/_next/static/chunks/a.js',
    '/_next/static/media/font.woff2',
    '/auth/callback',
    '/icon.svgx',
    '/robots.txt.bak',
    '/.well-known/other',
    '/api/mcp',
    '/api/mcp/2b1c0e4a-0000-4000-8000-000000000001',
    '/api/mcp/a/b',
    '/icon.svg',
    '/robots.txt',
    '/.well-known/security.txt',
    '/email/mcproof-logo.png',
    '/email/mcproof-logo.pngx',
    '/email/other.png',
  ];

  it.each(PATHS)('%s resolves to exactly its route class header set', (pathname) => {
    expect(resolved(pathname).headers).toEqual(securityHeadersFor(routeClassOf(pathname)));
  });

  it.each(PATHS)('%s has no header set by two rules, so none can be sent twice', (pathname) => {
    expect(resolved(pathname).setTwice).toEqual([]);
  });

  it('never carries a policy: the nonce is per request, so the middleware sends it', () => {
    const keys = securityHeaderRules().flatMap((r) => r.headers.map((h) => h.key.toLowerCase()));

    expect(keys).not.toContain('content-security-policy');
    expect(keys).not.toContain('content-security-policy-report-only');
  });

  it('is what next.config.ts returns from headers()', async () => {
    expect(await nextConfig.headers?.()).toEqual(securityHeaderRules());
  });
});

describe('next.config.ts and vercel.json', () => {
  it('switches the X-Powered-By banner off', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it('leaves vercel.json no header block: one place decides headers', () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
      headers?: unknown;
    };

    expect(vercel.headers).toBeUndefined();
  });

  it('still sends the three headers vercel.json used to set, on every path', () => {
    for (const pathname of ['/', '/api/health', '/api/mcp/x', '/icon.svg', '/_next/static/a.js']) {
      expect(resolved(pathname).headers).toMatchObject({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      });
    }
  });
});

describe('the nonce', () => {
  it('is base64 of at least 128 random bits', () => {
    const nonce = mintNonce();

    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(Buffer.from(nonce, 'base64').byteLength).toBeGreaterThanOrEqual(16);
  });

  it('is never repeated', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => mintNonce()));

    expect(seen.size).toBe(2000);
  });

  it('can be read back out of the policy that carries it', () => {
    const nonce = mintNonce();

    expect(nonceOf(buildContentSecurityPolicy({ nonce }))).toBe(nonce);
    expect(nonceOf("default-src 'self'")).toBeNull();
  });
});

describe('the content security policy', () => {
  const nonce = 'dGVzdC1ub25jZS0wMDAwMDAwMA==';

  it('is sent report-only', () => {
    expect(CSP_REPORT_ONLY_HEADER).toBe('Content-Security-Policy-Report-Only');
  });

  it('reads exactly like this in production, with Supabase configured', () => {
    expect(
      buildContentSecurityPolicy({ nonce, supabaseOrigin: 'https://abc.supabase.co' }).split('; '),
    ).toEqual([
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      `style-src 'self' 'nonce-${nonce}'`,
      "style-src-attr 'unsafe-inline'",
      "img-src 'self'",
      "font-src 'self'",
      "connect-src 'self' https://abc.supabase.co",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]);
  });

  it('names no Supabase origin when none is configured', () => {
    const policy = buildContentSecurityPolicy({ nonce });

    expect(policy).toContain("connect-src 'self';");
    expect(policy).not.toMatch(/supabase/);
    expect(buildContentSecurityPolicy({ nonce, supabaseOrigin: null })).toBe(policy);
  });

  it('reduces a Supabase URL to its origin and drops one that is not a URL', () => {
    expect(
      buildContentSecurityPolicy({ nonce, supabaseOrigin: 'http://127.0.0.1:54321/auth/v1?x=1' }),
    ).toContain("connect-src 'self' http://127.0.0.1:54321;");
    expect(buildContentSecurityPolicy({ nonce, supabaseOrigin: "x'; script-src *" })).toContain(
      "connect-src 'self';",
    );
  });

  it('allows no inline script and no eval in production', () => {
    const policy = buildContentSecurityPolicy({ nonce });
    const script = policy.split('; ').find((d) => d.startsWith('script-src ')) ?? '';

    expect(script).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it('allows inline styles only as attributes', () => {
    const directives = buildContentSecurityPolicy({ nonce }).split('; ');
    const unsafeInline = directives.filter((d) => d.includes("'unsafe-inline'"));

    expect(unsafeInline).toEqual(["style-src-attr 'unsafe-inline'"]);
  });

  it('allows eval and unnonced style tags in development only', () => {
    const policy = buildContentSecurityPolicy({ nonce, development: true });

    expect(policy).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval';`);
    expect(policy).toContain("style-src 'self' 'unsafe-inline';");
  });

  it('has no reporting endpoint and nothing a report-only policy ignores by design', () => {
    const policy = buildContentSecurityPolicy({ nonce });

    expect(policy).not.toMatch(/report-uri|report-to|upgrade-insecure-requests/);
  });

  it('refuses a nonce that could break out of its quotes', () => {
    expect(() => buildContentSecurityPolicy({ nonce: "x' 'unsafe-inline" })).toThrow();
  });
});
