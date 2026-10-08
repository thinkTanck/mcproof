import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * A CONNECTED RUN'S PINNED BAR FITS A SMALL PHONE (sweep 2026-10-07, C3).
 *
 * At 320x568 the bar was 155px while an agent was connected: the status wrapped
 * to two lines, END RUN AND JUDGE dropped to a row of its own, and its label
 * wrapped too. With the 72px header that is 40% of the screen held still while
 * the setup underneath is read. #173 and #175 had measured 360 and 390 only.
 *
 * Below 640px it is now two rows: the phase reading, then the tool-call count
 * on the left and END RUN on the right. The target is at most 114px, a fifth of
 * the screen. From 640px up the bar is exactly as it was.
 *
 * Measured in both fonts. Geist loads with `display: 'optional'`, so a FIRST
 * visit keeps the wider fallback; the web-font case loads the page once to fill
 * the cache and measures the second load. Driven through the Connect states
 * fixture (`/e2e/connect-states`, built only with E2E_FIXTURES=1).
 */
test.skip(
  process.env.E2E_FIXTURES !== '1',
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
);

const bar = (page: Page) => page.getByRole('region', { name: /what we have actually seen/i });
const endRun = (page: Page) => bar(page).getByRole('button', { name: /end run/i });

async function connected(page: Page, font: 'fallback' | 'web') {
  await suppressBootSplash(page);
  if (font === 'fallback') {
    await page.context().route(/\.woff2?(\?|$)/, (route) => route.abort());
  } else {
    // Fill the cache, so the second load keeps the web font.
    await page.goto('/e2e/connect-states?state=connected');
    await page.waitForLoadState('networkidle');
  }
  await page.goto('/e2e/connect-states?state=connected');
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /issue run endpoint/i }).click();
  await expect(endRun(page)).toBeVisible();
  await expect(bar(page).getByText('AGENT CONNECTED')).toBeVisible();
}

/** Where the pieces of the bar are drawn. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const dock = document.querySelector('section[aria-labelledby="connect-state"]')!;
    const status = dock.querySelector('[role="status"]')!;
    const label = [...status.querySelectorAll('span')].find((s) =>
      /^AGENT CONNECTED$/.test(s.textContent ?? ''),
    )!;
    const count = [...status.querySelectorAll('span')].find((s) =>
      /tool calls/.test(s.textContent ?? ''),
    )!;
    const button = [...dock.querySelectorAll('button')].find((b) =>
      /END RUN/.test((b as HTMLElement).innerText),
    )!;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height };
    };
    const fonts = [...document.fonts].filter((f) => f.status === 'loaded').length;
    return {
      dock: box(dock),
      label: box(label),
      count: box(count),
      button: box(button),
      buttonText: (button as HTMLElement).innerText.trim(),
      webFontLoaded: fonts > 2,
    };
  });
}

for (const font of ['fallback', 'web'] as const) {
  test.describe(`320x568, ${font} font`, () => {
    test.use({ viewport: { width: 320, height: 568 } });

    test('the connected bar is at most 114px', async ({ page }) => {
      await connected(page, font);
      const g = await geometry(page);
      test.info().annotations.push({
        type: 'bar height',
        description: `${Math.round(g.dock.height)}px (${font} font, web font loaded: ${g.webFontLoaded})`,
      });

      expect(g.dock.height).toBeLessThanOrEqual(114);
    });

    test('the count and END RUN share one row under the phase reading, inside the bar', async ({
      page,
    }) => {
      await connected(page, font);
      const g = await geometry(page);

      // Row 1: the phase reading, wholly above the row below it.
      expect(g.label.bottom).toBeLessThanOrEqual(Math.min(g.count.top, g.button.top) + 0.5);
      // Row 2: the count's centre sits inside END RUN's height.
      const countMiddle = (g.count.top + g.count.bottom) / 2;
      expect(countMiddle).toBeGreaterThan(g.button.top);
      expect(countMiddle).toBeLessThan(g.button.bottom);
      // Count on the left, END RUN on the right, not overlapping.
      expect(g.count.right).toBeLessThanOrEqual(g.button.left + 0.5);
      // Everything inside the bar.
      for (const piece of [g.label, g.count, g.button]) {
        expect(piece.left).toBeGreaterThanOrEqual(g.dock.left);
        expect(piece.right).toBeLessThanOrEqual(g.dock.right + 0.5);
        expect(piece.top).toBeGreaterThanOrEqual(g.dock.top);
        expect(piece.bottom).toBeLessThanOrEqual(g.dock.bottom + 0.5);
      }
      // The control keeps a full-size target, and the count's row is as tall.
      expect(g.button.height).toBeGreaterThanOrEqual(44);
      // The count is text, not a control: its ROW is the 44px one.
      expect(g.button.bottom - Math.min(g.count.top, g.button.top)).toBeGreaterThanOrEqual(44);
    });

    test('END RUN is the visible label, and the accessible name still says what it does', async ({
      page,
    }) => {
      await connected(page, font);
      const g = await geometry(page);

      expect(g.buttonText).toBe('END RUN');
      await expect(endRun(page)).toHaveAccessibleName('End run and judge');
      await expect(endRun(page)).toHaveAttribute('title', 'End run and judge');
      // Label in name (WCAG 2.5.3): the visible words are inside the name.
      expect('End run and judge'.toLowerCase()).toContain(g.buttonText.toLowerCase());
    });

    test('the status region still holds the phase reading and the count, together', async ({
      page,
    }) => {
      await connected(page, font);
      const status = bar(page).getByRole('status');

      await expect(status).toContainText('AGENT CONNECTED');
      await expect(status).toContainText('4');
      await expect(status).toContainText('tool calls');
      await expect(status.getByRole('button')).toHaveCount(0);
    });
  });
}

/**
 * FROM 640px UP: STRUCTURE, NOT PIXELS.
 *
 * This guard first asserted an exact height measured on Windows (73px at 640).
 * The Linux CI runner drew the same bar at 71px and failed it, and in the
 * official Playwright Linux image main and this branch both measured 72.97px at
 * 640x800: the layout had not changed, the fonts had. So it asserts what the
 * layout IS: the full label, the control in the same row as the phase reading,
 * and a ceiling well under the 105px the phone layout takes. That the classes at
 * 640px and up are main's own is held in
 * tests/unit/components/connect/connected-run-bar.test.tsx.
 */
for (const { width, height } of [
  { width: 640, height: 800 },
  { width: 1280, height: 900 },
]) {
  test.describe(`${width}x${height}: as it was`, () => {
    test.use({ viewport: { width, height } });

    test('keeps the full label, in the same row as the phase reading, under 90px', async ({
      page,
    }) => {
      await connected(page, 'fallback');
      const g = await geometry(page);

      expect(g.buttonText).toBe('END RUN AND JUDGE');
      // One row: the control's vertical range overlaps the phase reading's.
      expect(g.button.top).toBeLessThan(g.label.bottom);
      expect(g.button.bottom).toBeGreaterThan(g.label.top);
      expect(g.button.left).toBeGreaterThan(g.label.left);
      expect(g.dock.height).toBeLessThan(90);
    });
  });
}
