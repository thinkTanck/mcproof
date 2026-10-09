/**
 * The old host's redirect rules, evaluated with Next's own route matchers, so
 * the test reads the rules the way the router does. The e2e spec
 * (`tests/e2e/legacy-host.spec.ts`) proves the same thing on a real server.
 */
import type { IncomingMessage } from 'node:http';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import {
  matchHas,
  prepareDestination,
} from 'next/dist/shared/lib/router/utils/prepare-destination';
import { legacyHostRedirects } from '@/config/legacy-host';
import nextConfig from '../../../next.config';

const NEW = 'https://mcproof.dev';

/** Where a request for `pathname` on `host` is sent, or null if it is served. */
function resolve(host: string, pathname: string, target = NEW): string | null {
  const req = { headers: { host } } as unknown as IncomingMessage;
  for (const rule of legacyHostRedirects(target)) {
    const params = getPathMatch(rule.source, { removeUnnamedParams: true })(pathname);
    if (!params) continue;
    const hostParams = matchHas(req, {}, rule.has, rule.missing);
    if (!hostParams) continue;
    const { newUrl, parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: rule.destination,
      params: { ...params, ...hostParams },
      query: {},
    });
    return `${parsedDestination.protocol}//${parsedDestination.hostname}${newUrl}`;
  }
  return null;
}

describe('legacy host: mcpwn.dev page routes go to mcproof.dev', () => {
  it.each([
    ['/', `${NEW}/`],
    ['/connect', `${NEW}/connect`],
    ['/runs/sample-asi01', `${NEW}/runs/sample-asi01`],
    ['/findings/sample-asi06', `${NEW}/findings/sample-asi06`],
    ['/apis', `${NEW}/apis`],
    ['/auth/callback', `${NEW}/auth/callback`],
  ])('redirects %s', (path, to) => {
    expect(resolve('mcpwn.dev', path)).toBe(to);
    expect(resolve('www.mcpwn.dev', path)).toBe(to);
  });

  it('marks the move permanent', () => {
    expect(legacyHostRedirects(NEW).every((r) => r.permanent === true)).toBe(true);
  });
});

describe('legacy host: /api/* on mcpwn.dev is served, not redirected', () => {
  it.each([
    '/api',
    '/api/mcp/2b1c0e4a-0000-4000-8000-000000000001',
    '/api/mcp/run-1/',
    '/api/health',
  ])('serves %s', (path) => {
    expect(resolve('mcpwn.dev', path)).toBeNull();
  });
});

describe('legacy host: no other host is touched', () => {
  it.each([
    'mcproof.dev',
    'localhost',
    'preview-abc.vercel.app',
    'mcpwn.dev.example.com',
    'notmcpwn.dev',
  ])('leaves %s alone', (host) => {
    expect(resolve(host, '/connect')).toBeNull();
    expect(resolve(host, '/')).toBeNull();
  });

  it('makes no rules at all while the site origin is still the old host, so it cannot loop', () => {
    expect(legacyHostRedirects('https://mcpwn.dev')).toEqual([]);
    expect(legacyHostRedirects('https://www.mcpwn.dev')).toEqual([]);
  });
});

describe('next.config wires the rules', () => {
  it('returns the legacy host rules from redirects()', async () => {
    expect(await nextConfig.redirects?.()).toEqual(legacyHostRedirects());
  });
});
