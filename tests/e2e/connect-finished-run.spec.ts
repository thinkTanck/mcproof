import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * A FINISHED RUN SHOWS ITS RESULT, NOT ITS SETUP (sweep 2026-10-07, C2).
 *
 * After END RUN AND JUDGE the bar said RUN FINISHED while the section under it
 * was still headed YOUR RUN ENDPOINT and still drew the endpoint, the token, the
 * client tabs and CHECK IT TOOK: instructions for a token the run's end revoked.
 *
 * Driven through the Connect states fixture (`/e2e/connect-states`, built only
 * with E2E_FIXTURES=1), which renders the real Connect screen over a fake port.
 * Its saved result is the invented id `fixture-stored-run`.
 */
test.skip(
  process.env.E2E_FIXTURES !== '1',
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
);

const bar = (page: Page) => page.getByRole('region', { name: /what we have actually seen/i });
const result = (page: Page) => page.getByRole('region', { name: 'See the result.' });

async function finished(page: Page) {
  await suppressBootSplash(page);
  await page.goto('/e2e/connect-states?state=connected');
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /issue run endpoint/i }).click();
  // While the run is open the setup is there. This is what has to go.
  await expect(page.getByRole('heading', { name: 'Point your agent here.' })).toBeVisible();
  await page.getByRole('button', { name: /end run and judge/i }).click();
  await expect(bar(page).getByText('RUN FINISHED')).toBeVisible();
}

for (const [width, height] of [
  [1280, 900],
  [320, 568],
] as const) {
  test.describe(`finished run at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('the setup for the revoked token is gone', async ({ page }) => {
      await finished(page);

      await expect(page.locator('#connect-run-head')).toContainText('RUN FINISHED');
      await expect(page.locator('#connect-run-head')).not.toContainText(/endpoint/i);
      for (const heading of [
        'Point your agent here.',
        'Register the endpoint in your client.',
        'Give your agent its task.',
      ]) {
        await expect(page.getByRole('heading', { name: heading })).toHaveCount(0);
      }
      const column = page.locator('.panel-in');
      await expect(column.getByText('RUN ENDPOINT', { exact: true })).toHaveCount(0);
      await expect(column.getByText('RUN TOKEN', { exact: true })).toHaveCount(0);
      await expect(column.getByText('https://example.invalid/api/mcp/fixture-run')).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'MCP client' })).toHaveCount(0);
      await expect(column.getByText('CHECK IT TOOK')).toHaveCount(0);
      await expect(column.getByText(/AWAITING AGENT/)).toHaveCount(0);
      await expect(column.getByRole('button', { name: /^copy /i })).toHaveCount(0);
    });

    test('the result is one step away: replay and report, for this run', async ({ page }) => {
      await finished(page);

      await expect(page.getByTestId('run-state-detail')).toContainText(
        "Ending a run revokes its token, so this run's endpoint no longer accepts connections.",
      );
      await expect(result(page).getByRole('link', { name: 'Open the replay' })).toHaveAttribute(
        'href',
        '/runs/fixture-stored-run',
      );
      await expect(result(page).getByRole('link', { name: 'Open the report' })).toHaveAttribute(
        'href',
        '/findings/fixture-stored-run',
      );
      // One way to start again, in the pinned bar.
      await expect(page.getByRole('button', { name: /fresh run|new run/i })).toHaveCount(1);

      // The shorter page still fits its width, with both links inside it.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
      for (const link of await result(page).getByRole('link').all()) {
        await link.scrollIntoViewIfNeeded();
        await expect(link).toBeInViewport({ ratio: 1 });
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    });
  });
}
