import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE LINE UNDER THE TASK PREVIEW ON AN EXPIRED RUN (sweep 2026-10-07, C1).
 *
 * With a run open the preview says the issued run keeps its own task, "shown in
 * the last step". An expired run draws no such step (#180), so the line pointed
 * at nothing. It now reads as it does with no run at all.
 *
 * Driven through the Connect states fixture (`/e2e/connect-states`, built only
 * with E2E_FIXTURES=1). `state=expired` makes EVERY run that page issues an
 * expired one, so the return to the run-open wording is shown on a
 * `state=waiting` page; the full sequence on one page (expired, let go, a fresh
 * run that is live) is held in tests/unit/components/connect/preview-helper.test.tsx.
 */
test.skip(
  process.env.E2E_FIXTURES !== '1',
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
);

const NO_RUN = 'Issue a run to get your endpoint and token.';
const RUN_OPEN =
  'Lined up for your next run. The run you issued keeps its own task, shown in the last step.';

const bar = (page: Page) => page.getByRole('region', { name: /what we have actually seen/i });
/** The helper line: the last paragraph of the preview box. */
const helper = (page: Page) =>
  page.getByRole('group', { name: 'TASK PREVIEW' }).locator('p').last();

async function liveOn(page: Page, state: 'expired' | 'waiting') {
  await suppressBootSplash(page);
  await page.goto(`/e2e/connect-states?state=${state}`);
  await page.getByRole('button', { name: /^LIVE/ }).click();
}

test('an expired run reads as no run: nothing about a last step', async ({ page }) => {
  await liveOn(page, 'expired');
  await expect(helper(page)).toHaveText(NO_RUN);

  await page.getByRole('button', { name: /issue run endpoint/i }).click();
  await expect(bar(page).getByText('RUN EXPIRED')).toBeVisible();

  await expect(helper(page)).toHaveText(NO_RUN);
  await expect(helper(page)).not.toContainText(/last step/i);
  // The step the old line pointed at is not drawn for an expired run.
  await expect(page.getByRole('heading', { name: 'Give your agent its task.' })).toHaveCount(0);
});

test('after ISSUE A FRESH RUN the line still says to issue one', async ({ page }) => {
  await liveOn(page, 'expired');
  await page.getByRole('button', { name: /issue run endpoint/i }).click();
  await expect(bar(page).getByText('RUN EXPIRED')).toBeVisible();

  await page.getByRole('button', { name: /issue a fresh run/i }).click();

  await expect(page.getByRole('button', { name: /issue run endpoint/i })).toBeVisible();
  await expect(helper(page)).toHaveText(NO_RUN);
});

test('a run that is open keeps the run-open wording, with its task on the page', async ({
  page,
}) => {
  await liveOn(page, 'waiting');
  await page.getByRole('button', { name: /issue run endpoint/i }).click();
  await expect(bar(page).getByText('AWAITING AGENT')).toBeVisible();

  await expect(helper(page)).toHaveText(RUN_OPEN);
  await expect(page.getByRole('heading', { name: 'Give your agent its task.' })).toBeVisible();
});
