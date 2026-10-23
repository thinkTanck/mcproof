/**
 * RESPONSE SECURITY HEADERS: the one place they are decided.
 *
 * Two readers. `next.config.ts` takes {@link securityHeaderRules} for the
 * headers that are the same on every response, so `next start` and the deployed
 * app send the same thing and a browser test can read them. The middleware takes
 * {@link buildContentSecurityPolicy} and {@link mintNonce} for the one header
 * that cannot be static, because its nonce is new for every request.
 *
 * `next.config.ts` loads this file before any path alias exists, so it imports
 * nothing of the app's.
 *
 * ── THREE ROUTE CLASSES ──
 *
 *  - `default`: pages, API routes, static assets, 404s. The base set plus
 *    `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`, both
 *    `same-origin`.
 *  - `mcp`: `/api/mcp/*`. The base set ONLY. That endpoint is called by an
 *    agent's MCP client from anywhere, never by this site's own pages, so it
 *    gets no policy, no opener policy and no resource policy: nothing there may
 *    stand between a client and its answer. The middleware does not run on it at
 *    all (its matcher excludes `/api`).
 *  - `public-file`: the files published for other sites and tools to fetch (the
 *    icon, `robots.txt`, `security.txt`, the email logo). `Cross-Origin-Resource-Policy:
 *    cross-origin`, so a page on another origin can embed or read them.
 *
 * The rules below have sources that never overlap on a header, so no response is
 * given the same header by two rules.
 */

/** A header rule in the shape `next.config.ts` `headers()` returns. */
export interface HeaderRule {
  readonly source: string;
  readonly headers: { key: string; value: string }[];
}

export type RouteClass = 'default' | 'mcp' | 'public-file';

/**
 * Two years, and every subdomain. No `preload`: the whole `.dev` TLD is already
 * on the browsers' preload list, so the directive would add nothing.
 */
export const HSTS_VALUE = 'max-age=63072000; includeSubDomains';

/**
 * Features the app never uses, denied for the page and everything it embeds.
 * `clipboard-write` is deliberately absent: the copy buttons need it.
 */
export const PERMISSIONS_POLICY_VALUE =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

/**
 * The policy is sent REPORT-ONLY: the browser reports what it would have
 * blocked and blocks nothing. `frame-ancestors` is ignored in a report-only
 * policy, which is why `X-Frame-Options: DENY` stays in the base set.
 */
export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';

/** On every response, the MCP endpoint included. None of these can affect a non-browser client. */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': HSTS_VALUE,
  'Permissions-Policy': PERMISSIONS_POLICY_VALUE,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

const COOP = 'Cross-Origin-Opener-Policy';
const CORP = 'Cross-Origin-Resource-Policy';

/** The MCP endpoint's path prefix. Everything at or under it is class `mcp`. */
const MCP_PREFIX = '/api/mcp';

/** Files meant to be fetched from other origins. Exact paths. */
// The sign-in email's logo is drawn by mail clients on other origins, so it is
// one of these (LAUNCH POLISH, Part 7).
export const PUBLIC_FILE_PATHS = [
  '/icon.svg',
  '/robots.txt',
  '/.well-known/security.txt',
  '/email/mcproof-logo.png',
] as const;

/** Which class a request path belongs to. */
export function routeClassOf(pathname: string): RouteClass {
  if (pathname === MCP_PREFIX || pathname.startsWith(`${MCP_PREFIX}/`)) return 'mcp';
  if ((PUBLIC_FILE_PATHS as readonly string[]).includes(pathname)) return 'public-file';
  return 'default';
}

/** The static headers a response of that class carries. The policy is not among them. */
export function securityHeadersFor(routeClass: RouteClass): Record<string, string> {
  if (routeClass === 'mcp') return { ...BASE_HEADERS };
  return {
    ...BASE_HEADERS,
    [COOP]: 'same-origin',
    [CORP]: routeClass === 'public-file' ? 'cross-origin' : 'same-origin',
  };
}

/** A path as a pattern that matches it and nothing longer, without its leading slash. */
function exactly(path: string): string {
  return `${path.slice(1).replace(/\./g, '\\.')}(?![^/])`;
}

const entries = (headers: Record<string, string>) =>
  Object.entries(headers).map(([key, value]) => ({ key, value }));

/**
 * The rules for `next.config.ts`. Four, and no path gets one header from two of
 * them:
 *
 *  1. every path: the base set;
 *  2. every path outside `/api/mcp`: the opener policy;
 *  3. every path outside `/api/mcp` that is not a public file: resource policy `same-origin`;
 *  4. each public file: resource policy `cross-origin`.
 *
 * The exclusions are negative lookaheads in the `source`, the same form the
 * middleware matcher and the legacy-host redirect use. `(?![^/])` ends a
 * segment, so `/api/mcp-docs` or `/icon.svgx` is not caught by mistake.
 */
export function securityHeaderRules(): HeaderRule[] {
  const mcp = exactly(MCP_PREFIX);
  const publicFiles = PUBLIC_FILE_PATHS.map(exactly);
  return [
    { source: '/(.*)', headers: entries(BASE_HEADERS) },
    { source: `/((?!${mcp}).*)`, headers: [{ key: COOP, value: 'same-origin' }] },
    {
      source: `/((?!${[mcp, ...publicFiles].join('|')}).*)`,
      headers: [{ key: CORP, value: 'same-origin' }],
    },
    ...PUBLIC_FILE_PATHS.map((path) => ({
      source: path.replace(/\./g, '\\.'),
      headers: [{ key: CORP, value: 'cross-origin' }],
    })),
  ];
}

/** What a nonce may be made of: base64. Anything else could close its own quotes. */
const NONCE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * A new nonce: 144 random bits as base64 (24 characters, no padding). Web Crypto,
 * so it runs wherever the middleware does.
 */
export function mintNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes));
}

/** The nonce a policy carries, or `null` when it has none. */
export function nonceOf(policy: string): string | null {
  return /'nonce-([A-Za-z0-9+/]+={0,2})'/.exec(policy)?.[1] ?? null;
}

/** The origin of `value` if it is an http(s) URL, else `null`. Never throws. */
function httpOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

export interface ContentSecurityPolicyInput {
  /** This request's nonce, from {@link mintNonce}. */
  readonly nonce: string;
  /** The Supabase project URL from config, when auth is configured. */
  readonly supabaseOrigin?: string | null;
  /** `next dev` only. Never true in a production build. */
  readonly development?: boolean;
}

/**
 * The policy for one request, built from what the app really loads.
 *
 *  - `default-src 'self'`: anything not named below comes from this origin or not at all.
 *  - `script-src 'self' 'nonce-…' 'strict-dynamic'`: only the script tags Next
 *    renders, which carry the nonce, and what they load. No `'unsafe-inline'`.
 *    `'self'` is what a browser without `'strict-dynamic'` falls back to.
 *    `'unsafe-eval'` is added in development only, where React needs it.
 *  - `style-src 'self' 'nonce-…'`: the built stylesheets, and any style tag
 *    carrying the nonce.
 *  - `style-src-attr 'unsafe-inline'`: `style=""` attributes. The app positions
 *    and sizes things with them (the orbital's nodes, the heatmap cells, progress
 *    widths), their values are computed, and a nonce cannot cover an attribute.
 *    It allows no style TAG and no script.
 *  - `img-src 'self'`: the icon. Nothing in the build uses a `data:` or `blob:` image.
 *  - `font-src 'self'`: `next/font` serves the fonts from this origin.
 *  - `connect-src 'self'` plus the Supabase origin when one is configured.
 *  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`: no plugins, no
 *    re-pointing relative URLs, forms post only here (every form is a server action).
 *  - `frame-ancestors 'none'`: nothing may frame the site. A browser ignores this
 *    directive while the policy is report-only; it is here for the day it is
 *    enforced, and `X-Frame-Options: DENY` does the job until then.
 *
 * Deliberately absent: `upgrade-insecure-requests` (ignored in a report-only
 * policy, and HSTS covers it) and any `report-uri` / `report-to` (there is no
 * collector; violations are reported in the browser console).
 */
export function buildContentSecurityPolicy({
  nonce,
  supabaseOrigin,
  development = false,
}: ContentSecurityPolicyInput): string {
  if (!NONCE.test(nonce)) throw new Error('A policy nonce must be base64.');
  const supabase = httpOrigin(supabaseOrigin);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    development ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self'",
    "font-src 'self'",
    `connect-src 'self'${supabase === null ? '' : ` ${supabase}`}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
