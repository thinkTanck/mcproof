import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EVERY PUBLIC SHIPPED ROUTE IS CWV-MEASURED IN CI.
 *
 * The Lighthouse gate used to collect exactly one URL (`/`). Every screen built
 * after that shipped with CWV numbers taken by hand on a developer machine and
 * never by the gate, which is the same asserted-versus-measured gap the rest of
 * this project exists to close. Worse, the gap was silent: adding a screen cost
 * nothing, so nothing ever noticed.
 *
 * This test makes it cost something. The route list is DERIVED from the App
 * Router tree rather than restated here, so a new `page.tsx` fails this test
 * until it is either added to `lighthouserc.json` or written down below with a
 * reason it cannot be collected.
 */

// Vitest runs from the repo root. Under the jsdom environment `import.meta.url`
// is an http URL rather than a file one, so cwd is the honest anchor here.
const repoRoot = process.cwd();

/** Routes a Lighthouse collection cannot reach, each with the reason it cannot. */
const NOT_COLLECTABLE: Record<string, string> = {
  // Lighthouse drives a cold browser with no cookie jar, so a session-gated
  // route redirects to /sign-in and the run would measure the sign-in page under
  // the account page's name. Its accessibility is covered instead by the
  // authenticated axe scan (`tests/e2e/authenticated.spec.ts`).
  '/account': 'needs a real session; measured screen would be /sign-in',
  '/missing/run': 'not a page of its own: the 404 the middleware rewrites /runs/<id> to',
  '/missing/report': 'not a page of its own: the 404 the middleware rewrites /findings/<id> to',
};

/**
 * A concrete instance for each dynamic route, because a URL is what Lighthouse
 * loads. Both are the sample run, which needs no sign-in and no database.
 */
const DYNAMIC_INSTANCE: Record<string, string> = {
  '/runs/[id]': '/runs/sample',
  '/findings/[id]': '/findings/sample',
};

/** Every route the App Router serves a page for, as a route pattern. */
function shippedRoutes(): string[] {
  return readdirSync(join(repoRoot, 'src', 'app'), { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split('\\').join('/'))
    .filter((entry) => entry.endsWith('page.tsx'))
    .map((file) =>
      `/${file}`
        .replace(/\/page\.tsx$/, '')
        // Route GROUPS — `(hud)` — organize files, not URLs.
        .replace(/\/\([^/]+\)/g, ''),
    )
    .map((route) => (route === '' ? '/' : route))
    .sort();
}

type LighthouseRc = {
  ci: {
    collect: { url: string[]; numberOfRuns: number; settings: { throttlingMethod: string } };
    assert: { aggregationMethod: string };
  };
};

function lighthouseRc(): LighthouseRc {
  return JSON.parse(readFileSync(join(repoRoot, 'lighthouserc.json'), 'utf8'));
}

describe('the Lighthouse CWV gate', () => {
  const rc = lighthouseRc();
  const collectedPaths = rc.ci.collect.url.map((url) => new URL(url).pathname);

  it('collects a URL for every public shipped route', () => {
    const expected = shippedRoutes()
      .filter((route) => !(route in NOT_COLLECTABLE))
      .map((route) => DYNAMIC_INSTANCE[route] ?? route);

    // Sorted set comparison: a failure names the missing route, and an extra
    // collected URL that matches no shipped route fails too (a gate pointed at a
    // 404 measures the not-found page and calls it a screen).
    expect([...collectedPaths].sort()).toEqual([...expected].sort());
  });

  it('names a reason for every route it does not collect', () => {
    const shipped = shippedRoutes();
    for (const [route, reason] of Object.entries(NOT_COLLECTABLE)) {
      expect(shipped, `${route} is listed as not-collectable but is not a shipped route`).toContain(
        route,
      );
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it('keeps the measurement discipline ADR-0002 and ADR-0008 fixed', () => {
    // Measured, not simulated (ADR-0002); five runs aggregated at the median,
    // never a single measurement and never lhci's optimistic default (ADR-0008).
    expect(rc.ci.collect.settings.throttlingMethod).toBe('devtools');
    expect(rc.ci.collect.numberOfRuns).toBe(5);
    expect(rc.ci.assert.aggregationMethod).toBe('median');
  });
});
