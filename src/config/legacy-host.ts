import type { Redirect } from 'next/dist/lib/load-custom-routes';
// Relative, not `@/`: next.config.ts loads this before any path alias exists.
import { getSiteOrigin } from './env';

/**
 * The product was MCPwn, served on `mcpwn.dev`, until 2026-10-08. The old host
 * stays attached to the deployment, and these rules send its PAGE routes to the
 * new origin.
 *
 * `/api/*` IS NOT REDIRECTED, ON PURPOSE. Every run issued before the rename has
 * an endpoint under `https://mcpwn.dev/api/mcp/<run>` saved in an agent's MCP
 * config. An MCP client posting there does not reliably follow a redirect, and a
 * cross-origin redirect drops the `Authorization` header that carries the run
 * token, so a redirect would end every in-flight run at the moment of deploy.
 * The old host keeps serving the API directly; page routes are the only thing a
 * person ever types or bookmarks.
 */

/** The old host, and its `www.` form, as a `has` host pattern (Next anchors it). */
export const LEGACY_HOST_PATTERN = '(?:www\\.)?mcpwn\\.dev';

const LEGACY_HOST = /^(?:www\.)?mcpwn\.dev$/i;

/**
 * The redirect rules for `next.config.ts`. The target is the configured site
 * origin; if that is still the old host (the deployment's `NEXT_PUBLIC_SITE_URL`
 * not yet changed), there are no rules at all, because a host redirecting to
 * itself is a loop.
 */
export function legacyHostRedirects(target: string = getSiteOrigin()): Redirect[] {
  const origin = new URL(target).origin;
  if (LEGACY_HOST.test(new URL(origin).hostname)) return [];
  const has: Redirect['has'] = [{ type: 'host', value: LEGACY_HOST_PATTERN }];
  return [
    { source: '/', has, destination: `${origin}/`, permanent: true },
    {
      // Any path whose first segment is not `api`, with everything below it.
      source: '/:first((?!api(?![^/]))[^/]+)/:rest*',
      has,
      destination: `${origin}/:first/:rest*`,
      permanent: true,
    },
  ];
}
