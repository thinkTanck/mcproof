import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE SWIPE CUE IS SHOWN ONLY WHEN THE TABLE OVERFLOWS (owner ruling
 * 2026-10-18), measured on a populated board (the `/e2e/leaderboard` fixture,
 * the real heatmap over the seven sample traces).
 */
const FIXTURES_BUILT = process.env.E2E_FIXTURES === '1';
const CUE = 'Swipe the table left to see all 7 attack types.';

async function open(page: Page) {
  await suppressBootSplash(page);
  await page.goto('/e2e/leaderboard');
  await expect(page.getByRole('region', { name: /heatmap/i })).toBeVisible();
  // The cue has measured once it carries its answer.
  await expect(page.locator('[data-swipe-cue][data-overflow]')).toHaveCount(1);
}

const overflows = (page: Page) =>
  page.getByRole('region', { name: /heatmap/i }).evaluate((el) => el.scrollWidth > el.clientWidth);

test.describe('the leaderboard swipe cue', () => {
  test.skip(!FIXTURES_BUILT, 'needs a build with E2E_FIXTURES=1');

  test('at 390 the table overflows, and the cue is shown', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    expect(await overflows(page)).toBe(true);
    await expect(page.getByText(CUE)).toBeVisible();
  });

  // 900 overflows only once the web font has loaded: the cue must follow the
  // table as it grows, not keep its first, fallback-font answer.
  test('at 900 it is shown once the font has loaded and the table has grown', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await open(page);
    await page.evaluate(() => document.fonts.ready);
    expect(await overflows(page)).toBe(true);
    await expect(page.getByText(CUE)).toBeVisible();
  });

  for (const width of [1280, 1440]) {
    test(`at ${width} every column fits, and the cue is hidden`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      expect(await overflows(page)).toBe(false);
      await expect(page.getByText(CUE)).toBeHidden();
    });
  }

  test('it follows a resize, both ways', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open(page);
    await expect(page.getByText(CUE)).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText(CUE)).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByText(CUE)).toBeHidden();
  });
});
