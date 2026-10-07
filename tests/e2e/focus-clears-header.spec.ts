import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * KEYBOARD FOCUS IS NEVER PARKED UNDER THE HEADER (sweep 2026-10-07, X1;
 * WCAG 2.2, 2.4.11 Focus Not Obscured).
 *
 * The header is sticky. When Tab or Shift+Tab brings a control to the top edge
 * of the window, the browser puts it at y=0, which is behind the header: focused
 * and fully hidden. #167 and #175 gave the run column on Connect a scroll margin
 * for exactly this; nothing did the same for the rest of the app.
 *
 * THE RULE, per stop: a focused control in the page content starts at or below
 * the bottom edge of the header. Measured from real rects in a real browser, the
 * way the sweep found it, because jsdom lays nothing out.
 */

type Stop = { name: string; top: number; bottom: number; headerBottom: number; inMain: boolean };

async function focused(page: Page): Promise<Stop> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const rect = el.getBoundingClientRect();
    const header = document.querySelector('header');
    return {
      name: (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      headerBottom: header ? Math.round(header.getBoundingClientRect().bottom) : 0,
      inMain: el.closest('main') !== null,
    };
  });
}

/** Tab forward from the top of the document through `presses` stops. */
async function walkForward(page: Page, presses: number): Promise<Stop[]> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const stops: Stop[] = [];
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press('Tab');
    stops.push(await focused(page));
  }
  return stops;
}

/**
 * Shift+Tab upward from the last control on the page: the path that lands each
 * control at the top edge, under whatever is pinned there.
 */
async function walkBackward(page: Page, presses: number): Promise<Stop[]> {
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const all = [
      ...document.querySelectorAll<HTMLElement>('main :is(a[href], button, [tabindex="0"])'),
    ].filter((el) => el.getBoundingClientRect().width > 1);
    all[all.length - 1]?.focus();
  });
  const stops: Stop[] = [await focused(page)];
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press('Shift+Tab');
    stops.push(await focused(page));
  }
  return stops;
}

/** Every stop in the page content clears the header; the named ones were really visited. */
function expectClear(stops: Stop[], mustVisit: RegExp[]) {
  const inContent = stops.filter((stop) => stop.inMain);
  for (const wanted of mustVisit) {
    expect(
      inContent.some((stop) => wanted.test(stop.name)),
      `the walk reached ${wanted}: ${inContent.map((s) => s.name.slice(0, 24)).join(' > ')}`,
    ).toBe(true);
  }
  for (const stop of inContent) {
    expect(
      stop.top,
      `"${stop.name.slice(0, 50)}" starts at y=${stop.top}, under the header (bottom ${stop.headerBottom})`,
    ).toBeGreaterThanOrEqual(stop.headerBottom);
  }
}

test.beforeEach(async ({ page }) => {
  await suppressBootSplash(page);
});

test.describe('Home', () => {
  test('1280, Tab forward: the Core-7 sample links are not under the header', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');

    expectClear(await walkForward(page, 22), [/^Watch the ASI01 Agent Goal Hijack sample/]);
  });

  test('320, Shift+Tab: Play ASI02 sample and Connect your agent are not under the header', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');

    expectClear(await walkBackward(page, 14), [/^Play ASI02 sample/, /^Connect your agent/]);
  });
});

test.describe('Connect', () => {
  const MODES = [/^SAMPLE · no sign-in/, /^LIVE · your agent connects to us/];

  test('390, Shift+Tab, sample mode: both MODE buttons are not under the header', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/connect');

    expectClear(await walkBackward(page, 12), MODES);
  });

  test('390, Shift+Tab, live gate (signed out): both MODE buttons are not under the header', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/connect');
    await page.getByRole('button', { name: /^LIVE/ }).click();

    expectClear(await walkBackward(page, 14), MODES);
  });

  test('1280, Shift+Tab: the checked category radio is not under the header', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/connect');

    expectClear(await walkBackward(page, 8), [/^ASI02\s*Tool Misuse and Exploitation/]);
  });

  test('390, Shift+Tab, with a run open: both MODE buttons are not under the header', async ({
    page,
  }) => {
    test.skip(
      process.env.E2E_FIXTURES !== '1',
      'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this case drives is not built.',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/e2e/connect-states?state=waiting');
    await page.getByRole('button', { name: /^LIVE/ }).click();
    await page.getByRole('button', { name: /issue run endpoint/i }).click();
    await expect(page.getByRole('region', { name: /what we have actually seen/i })).toBeVisible();

    expectClear(await walkBackward(page, 30), MODES);
  });
});

test.describe('Replay', () => {
  test('320, Shift+Tab: the export links are not under the header', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/runs/sample');
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();

    expectClear(await walkBackward(page, 14), [/^Export fix report/, /^Decline export/]);
  });
});
