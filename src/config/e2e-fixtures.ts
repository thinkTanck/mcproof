/**
 * E2E FIXTURE ROUTES: BUILT ONLY WHEN A BUILD ASKS FOR THEM.
 *
 * A fixture route renders a real screen over fake data, so a browser test can
 * reach a state CI cannot produce on its own. A finished live run, for one,
 * needs a signed-in user, a connected agent and a judge.
 *
 * It must never ship, so it is excluded at BUILD time rather than hidden at run
 * time. Its file is named `page.e2e.tsx`, and Next treats that as a page only
 * when `e2e.tsx` is in `pageExtensions`, which happens only when E2E_FIXTURES=1
 * is set for the build. A normal build does not contain the route at all; CI
 * proves that against the build manifest (`scripts/verify-no-e2e-routes.ts`).
 * The route also calls `notFound()` without the flag, as a second layer.
 *
 * Read by `next.config.ts` at build time and by the fixture route at run time.
 * Build tooling, not app config, so it lives here rather than in `env.ts`.
 */

type Env = Record<string, string | undefined>;

/** Next's own default page extensions. */
const DEFAULT_PAGE_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js'];

/** The extension that marks a fixture page. */
export const E2E_PAGE_EXTENSION = 'e2e.tsx';

/** Only the exact string `1` turns fixtures on. A flag that half-reads as on is how they leak. */
export function isE2eFixturesEnabled(env: Env): boolean {
  return env.E2E_FIXTURES === '1';
}

/** The page extensions for this build: the defaults, plus the fixture one only on request. */
export function pageExtensionsFor(env: Env): string[] {
  return isE2eFixturesEnabled(env)
    ? [...DEFAULT_PAGE_EXTENSIONS, E2E_PAGE_EXTENSION]
    : [...DEFAULT_PAGE_EXTENSIONS];
}

/** Refuse a production deploy that would carry fixture routes. */
export function assertE2eFixturesAllowed(env: Env): void {
  if (isE2eFixturesEnabled(env) && env.VERCEL_ENV === 'production') {
    throw new Error(
      'E2E_FIXTURES=1 is set on a production build (VERCEL_ENV=production). Fixture routes ' +
        'render fake data for browser tests and must never ship; unset E2E_FIXTURES.',
    );
  }
}

/** Every fixture route in a Next app-path routes manifest (`.next/app-path-routes-manifest.json`). */
export function findFixtureRoutes(routes: Record<string, string>): string[] {
  return Object.values(routes).filter((route) => route === '/e2e' || route.startsWith('/e2e/'));
}
