import { expect, type Page } from '@playwright/test';

/**
 * A replay shows no verdict until it is revealed (owner ruling 2026-10-17): at
 * the last step, or on "Show verdict now". A spec that measures the verdict,
 * its rail, the title badge, the breach mark or the export buttons reveals it
 * first, the way a reader would.
 */
export async function revealVerdict(page: Page): Promise<void> {
  const show = page.getByRole('button', { name: 'Show verdict now' });
  await show.click();
  await expect(page.getByTestId('run-outcome')).toBeVisible();
}
