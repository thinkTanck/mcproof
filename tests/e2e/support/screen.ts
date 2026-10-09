import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** WCAG 2.0/2.1/2.2 level A and AA — the conformance target in the DoD. */
export const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** The flag `BootSplash` reads to decide it has already been shown this session. */
export const SPLASH_SEEN_KEY = 'mcproof.boot.v1.seen';

/**
 * DETERMINISM, the hard-won kind.
 *
 * axe reads COMPUTED colour. The boot splash is a transient overlay kicked by
 * `requestIdleCallback` (1600ms timeout) and faded in over 320ms, so both
 * WHETHER it is on screen when the scan runs and HOW FAR THROUGH its fade it is
 * depend on how busy the main thread happens to be. Scanning mid-fade measures
 * half-transparent text and reports contrast no user ever sees: observed as low
 * as 1.07:1 for a control whose RESTING contrast is 5.2:1 and passes.
 *
 * That made this gate a coin flip. It passed on CI and failed locally on the
 * same commit, and it flipped verdict when an unrelated performance fix freed
 * the main thread and moved the idle callback earlier. Waiting for the splash to
 * detach is NOT enough either: when the splash has not appeared yet, that wait
 * resolves instantly and the scan races it on the way in. Measured 2 of 4 runs
 * failing that way.
 *
 * So the splash is suppressed outright, via the same session flag the component
 * itself honours. Every screen is then scanned in a settled state, every time.
 *
 * KNOWN GAP, stated rather than papered over: this gate therefore does NOT cover
 * the splash's own accessibility. Its roles and labels are covered by
 * `tests/unit/components/splash/boot-splash.test.tsx`, but its CONTRAST is not
 * covered anywhere, because a 2.5s self-dismissing overlay cannot be scanned
 * deterministically without pausing it. Worth closing with a dedicated
 * reduced-motion scan; not closed here.
 */
export async function suppressBootSplash(page: Page): Promise<void> {
  await page.addInitScript(
    ([key]) => window.sessionStorage.setItem(key as string, '1'),
    [SPLASH_SEEN_KEY],
  );
}

/**
 * Scan the settled page for WCAG A/AA violations and require zero.
 *
 * The assertion is on a rendered SUMMARY rather than the raw violation objects:
 * identical strictness (any violation makes the array non-empty), but a failure
 * names the rule and the offending selector instead of dumping an axe node tree.
 */
export async function expectNoWcagViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} [${v.impact ?? 'unknown'}] x${v.nodes.length} first=${v.nodes[0]?.target.join(' ')}`,
  );
  expect(summary, `WCAG A/AA violations on ${page.url()}`).toEqual([]);
  expect(results.violations).toEqual([]);
}

/**
 * Navigate to a route, assert it really served a 200 (not a 404/500 shell that
 * still renders chrome), and leave the page settled for a scan.
 */
export async function gotoOk(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), `HTTP status for ${path}`).toBe(200);
}
