import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE VERDICT IS REVEALED, NOT SHOWN AT LOAD (owner ruling 2026-10-17), in a
 * real browser: what the unit tests cannot see. The header's run chip (BREACH
 * or CLEAR, the category, the severity) is drawn by the server-rendered shell
 * and held invisible in its place by a CSS rule until the replay reveals its
 * verdict; "Show verdict now" is the first stop in the replay; and the fix
 * report still shows its verdict at once.
 */

const SAMPLES = ['sample', 'asi03-identity-privilege-abuse', 'asi05-code-execution'];

async function open(page: Page, id: string) {
  await suppressBootSplash(page);
  await page.goto(`/runs/${id}`);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
}

const chip = (page: Page) => page.locator('[data-run-verdict]');

test.describe('at 1280, where the header carries the run chip', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  for (const id of SAMPLES) {
    test(`/runs/${id}: hidden at load, revealed by "Show verdict now"`, async ({ page }) => {
      await open(page, id);
      const rail = page.getByRole('complementary', { name: 'Detector verdict' });
      await expect(rail).toContainText('detector@sentinel:~$ waiting for the run to finish...');
      await expect(page.getByTestId('run-outcome')).toHaveCount(0);
      await expect(page.locator('[data-breach-mark]')).toHaveCount(0);
      // Held in place, invisible: same box, so the header does not move.
      const before = await chip(page).boundingBox();
      await expect(chip(page)).toHaveCSS('visibility', 'hidden');

      // First stop in the replay: from the start of main, Tab lands on it.
      await page.locator('#main').focus();
      await page.keyboard.press('Tab');
      const show = page.getByRole('button', { name: 'Show verdict now' });
      await expect(show).toBeFocused();
      await page.keyboard.press('Enter');

      await expect(page.getByTestId('run-outcome')).toBeFocused();
      await expect(page.getByTestId('verdict-announcement')).toHaveText(/^Verdict: /);
      await expect(rail).not.toContainText('waiting for the run to finish');
      await expect(chip(page)).toHaveCSS('visibility', 'visible');
      expect(await chip(page).boundingBox()).toEqual(before);
    });
  }

  test('reaching the last step reveals it too', async ({ page }) => {
    await open(page, 'sample');
    const slider = page.getByRole('slider', { name: 'Scrub to step' });
    const max = Number(await slider.getAttribute('max'));
    await slider.fill(String(max - 1));
    await expect(page.getByTestId('run-outcome')).toHaveCount(0);
    await slider.fill(String(max));
    await expect(page.getByTestId('run-outcome')).toBeVisible();
    await expect(page.locator('[data-breach-mark]')).toHaveCount(1);
    await expect(chip(page)).toHaveCSS('visibility', 'visible');
  });

  test('the fix report shows its verdict at once, with no reveal', async ({ page }) => {
    await suppressBootSplash(page);
    await page.goto('/findings/sample');
    await expect(page.getByRole('button', { name: 'Show verdict now' })).toHaveCount(0);
    await expect(page.getByText(/compromised/i).first()).toBeVisible();
  });
});
