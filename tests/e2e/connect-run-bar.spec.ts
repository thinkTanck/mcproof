import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE PINNED RUN BAR, MEASURED IN A REAL BROWSER (issue #173).
 *
 * A finished run's bar holds two controls, OPEN THE REPLAY and ISSUE A FRESH RUN.
 * On a phone they used to stack, and the bar grew to 152px at 390x844 and 189px
 * at 360x640, screen the reader loses for as long as the bar is pinned. The
 * decision on the issue: both stay, side by side in one row below the narrow
 * breakpoint, with the short visible labels REPLAY and NEW RUN on phones (the
 * full pair does not fit at 360 or 390, measured), and full labels on desktop.
 *
 * Layout and visible labels depend on media queries, which jsdom does not apply,
 * so these run in Chromium against the Connect states fixture
 * (`/e2e/connect-states`, built only with E2E_FIXTURES=1; see
 * src/config/e2e-fixtures.ts). It renders the real Connect screen over fake data.
 */

test.skip(
  process.env.E2E_FIXTURES !== '1',
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
);

const FIXTURE = '/e2e/connect-states';

const bar = (page: Page) => page.getByRole('region', { name: /what we have actually seen/i });
const replay = (page: Page) => bar(page).getByRole('link', { name: /open the replay/i });
const fresh = (page: Page) => bar(page).getByRole('button', { name: /fresh run|new run/i });

/** Open the fixture in LIVE mode and issue a run against the given fake server state. */
async function issued(page: Page, state: 'waiting' | 'connected' | 'expired') {
  await suppressBootSplash(page);
  await page.goto(`${FIXTURE}?state=${state}`);
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /issue run endpoint/i }).click();
  await expect(bar(page)).toBeVisible();
}

/** A run judged on this page: the bar hands off to the replay and offers a fresh run. */
async function finished(page: Page) {
  await issued(page, 'connected');
  await page.getByRole('button', { name: /end run and judge/i }).click();
  await expect(replay(page)).toBeVisible();
  await expect(fresh(page)).toBeVisible();
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const [width, height] of [
  [360, 640],
  [390, 844],
] as const) {
  test.describe(`finished run bar at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('keeps both controls in one row, inside the bar, with no sideways scroll', async ({
      page,
    }) => {
      await finished(page);

      const [a, b, box] = await Promise.all([
        replay(page).boundingBox(),
        fresh(page).boundingBox(),
        bar(page).boundingBox(),
      ]);
      test.info().annotations.push({
        type: 'bar height',
        description: `${Math.round(box!.height)}px at ${width}x${height}`,
      });

      // One row: the same top offset.
      expect(Math.abs(a!.y - b!.y)).toBeLessThanOrEqual(1);
      // Both wholly inside the bar.
      for (const control of [a!, b!]) {
        expect(control.x).toBeGreaterThanOrEqual(box!.x);
        expect(control.x + control.width).toBeLessThanOrEqual(box!.x + box!.width + 0.5);
      }
      // Touch targets survive the tighter row.
      expect(a!.height).toBeGreaterThanOrEqual(44);
      expect(b!.height).toBeGreaterThanOrEqual(44);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
    });

    test('names each control with words that contain its visible label (WCAG 2.5.3)', async ({
      page,
    }) => {
      await finished(page);

      for (const control of [replay(page), fresh(page)]) {
        const visible = (await control.innerText()).trim();
        expect(visible.length).toBeGreaterThan(0);
        await expect(control).toHaveAccessibleName(new RegExp(escape(visible), 'i'));
      }
      // Phones show the short labels. Measured: OPEN THE REPLAY beside NEW RUN needs
      // 353px, and the row has 270px at 360 and 300px at 390 (decision on #173).
      expect((await replay(page).innerText()).trim()).toBe('REPLAY');
      expect((await fresh(page).innerText()).trim()).toBe('NEW RUN');
    });
  });
}

test.describe('finished run bar at 1280x900', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('keeps the full labels on desktop', async ({ page }) => {
    await finished(page);
    expect((await replay(page).innerText()).trim()).toBe('OPEN THE REPLAY');
    expect((await fresh(page).innerText()).trim()).toBe('ISSUE A FRESH RUN');
  });
});

/**
 * THE SCROLL MARGIN THAT KEEPS FOCUS CLEAR OF THE BAR.
 *
 * Every focusable in the run column carries a scroll margin, so a control that
 * keyboard focus brings to the top edge lands below the header and the pinned
 * bar, not under them (WCAG 2.2, 2.4.11). The margin is sized to the tallest bar,
 * so it has to be re-checked whenever the bar's height changes. Shift+Tab walks
 * upward, the path that lands each control at the top edge.
 */
const STATES: { name: string; reach: (page: Page) => Promise<void> }[] = [
  { name: 'waiting', reach: (page) => issued(page, 'waiting') },
  { name: 'connected', reach: (page) => issued(page, 'connected') },
  { name: 'finished', reach: finished },
  { name: 'expired', reach: (page) => issued(page, 'expired') },
  {
    name: 'selection mismatch',
    reach: async (page) => {
      await issued(page, 'waiting');
      const category = page.getByRole('radiogroup', { name: /attack category/i });
      await category.getByRole('radio', { checked: false }).first().click();
      await expect(page.getByTestId('run-selection-notice')).toBeVisible();
    },
  },
];

for (const [width, height] of [
  [1280, 900],
  [390, 844],
  [360, 640],
] as const) {
  test.describe(`focus stays clear of the bar at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const state of STATES) {
      test(`in the ${state.name} state`, async ({ page }) => {
        await state.reach(page);
        await page.getByRole('button', { name: /copy task goal/i }).focus();

        const hidden: string[] = [];
        for (let i = 0; i < 25; i++) {
          await page.keyboard.press('Shift+Tab');
          const covered = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            const dock = document.querySelector('section[aria-labelledby="connect-state"]');
            const column = document.querySelector('.panel-in');
            if (!el || !dock || !column || !column.contains(el) || dock.contains(el)) return null;
            const top = el.getBoundingClientRect().top;
            const cover = dock.getBoundingClientRect().bottom;
            return top < cover
              ? `${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)} (top ${Math.round(top)} < bar ${Math.round(cover)})`
              : null;
          });
          if (covered) hidden.push(covered);
        }
        expect(hidden, `controls under the bar at ${width}x${height}`).toEqual([]);
      });
    }
  });
}
