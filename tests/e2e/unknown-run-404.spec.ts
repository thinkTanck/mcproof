import { test, expect } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * UNKNOWN RUN IDS ANSWER 404, AND KEEP THEIR OWN WORDS (sweep 2026-10-07, X3).
 *
 * `/runs/does-not-exist` and `/findings/does-not-exist` used to render their
 * empty state with HTTP 200. The status is the fix; the copy stays, inside the
 * shell, so a person who mistyped an id still gets the way forward.
 *
 * NOT COVERED HERE: a real live run opened by someone who may not see it. No
 * fixture stores a live run, so a browser cannot reach that case. It is held to
 * the same 404 in `tests/unit/app/unknown-run-404.test.tsx`.
 */
test.beforeEach(async ({ page }) => {
  await suppressBootSplash(page);
});

test('/runs/does-not-exist answers 404 with the replay empty state', async ({ page }) => {
  const response = await page.goto('/runs/does-not-exist');
  expect(response?.status()).toBe(404);

  await expect(page.getByRole('heading', { level: 1, name: 'No run to replay.' })).toBeVisible();
  await expect(page.getByRole('main').getByText('does-not-exist')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Play the sample run' })).toBeVisible();
  // Still inside the shell, with no run on show and so no mode chip.
  await expect(page.getByRole('navigation', { name: 'Command deck' })).toBeVisible();
  await expect(page.locator('header').getByText(/^(SAMPLE|LIVE)$/)).toHaveCount(0);
  // Next marks a 404 as not for indexing.
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
});

test('/findings/does-not-exist answers 404 with the report empty state', async ({ page }) => {
  const response = await page.goto('/findings/does-not-exist');
  expect(response?.status()).toBe(404);

  await expect(
    page.getByRole('heading', { level: 1, name: 'No report for run does-not-exist' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Command deck' })).toBeVisible();
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
});

test('two different unknown ids get the same status and the same title', async ({ page }) => {
  const seen: { status: number | undefined; title: string }[] = [];
  for (const id of ['does-not-exist', '00000000-0000-4000-8000-000000000000']) {
    const response = await page.goto(`/runs/${id}`);
    seen.push({ status: response?.status(), title: await page.title() });
  }
  expect(seen[0]).toEqual(seen[1]);
  expect(seen[0]?.status).toBe(404);
});

test('a client-sent x-pathname header cannot change the id the 404 names', async ({ browser }) => {
  // The not-found page reads the path from `x-pathname`. The middleware sets
  // that header from the real URL, so one sent by the caller is discarded.
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-pathname': '/runs/chosen-by-the-caller' },
  });
  const page = await context.newPage();
  await suppressBootSplash(page);

  const response = await page.goto('/runs/does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('main').getByText('does-not-exist')).toBeVisible();
  await expect(page.getByText('chosen-by-the-caller')).toHaveCount(0);
  await context.close();
});

for (const path of ['/runs/sample', '/findings/sample', '/runs/asi10-goal-drift']) {
  test(`${path} still answers 200`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  });
}
