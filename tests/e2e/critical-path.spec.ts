import { test, expect } from '@playwright/test';
import { gotoOk, suppressBootSplash } from './support/screen';

/**
 * THE CRITICAL PATH, walked as a user walks it:
 *
 *   /connect  ->  play the sample  ->  /runs/[id] replay  ->  export the fix
 *   report  ->  /findings/[id]  ->  copy it to the clipboard.
 *
 * This is the journey the product is FOR, and until now no test walked it: the
 * e2e tier tested one page and `playwright.config.ts` granted clipboard
 * permissions for a copy test that did not exist. The clipboard step below is
 * that test, so the grant is now paid for.
 *
 * Screen-by-screen rendering and the WCAG scans live in `screens.spec.ts`; this
 * spec asserts the LINKAGE — that each step actually reaches the next.
 */
test.beforeEach(async ({ page }) => {
  await suppressBootSplash(page);
});

test('connect -> replay -> fix report -> clipboard', async ({ page }) => {
  // 1. Run setup. Sample mode needs no key and no sign-in.
  await gotoOk(page, '/connect');
  await expect(page.getByRole('heading', { level: 1, name: 'Set up a test run.' })).toBeVisible();

  // 2. Launch the sample. The CTA is the only route into the replay from here.
  await page.getByRole('link', { name: /play sample run/i }).click();
  await page.waitForURL(/\/runs\//);

  // 3. The replay hero streams a real trace: transport, verdict, step detail.
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toContainText('ASI02');
  const scrubber = page.getByRole('slider', { name: 'Scrub to step' });
  await expect(scrubber).toHaveAttribute('aria-valuetext', /^Step 1 of \d+$/);

  // Stepping is real: advancing the playhead moves the reported step.
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(scrubber).toHaveAttribute('aria-valuetext', /^Step 2 of \d+$/);
  await expect(page.getByRole('region', { name: 'Step detail' })).toBeVisible();

  // The verdict rail states the outcome throughout, not only at the end.
  const verdict = page.getByRole('complementary', { name: 'Detector verdict' });
  await expect(verdict).toContainText('COMPROMISED');

  // 4. Open the fix report. "Open fix report" is a real link, so it is keyboard
  //    and screen-reader operable; that is what we click.
  await page.getByRole('link', { name: 'Open fix report' }).click();
  await page.waitForURL(/\/findings\//);

  // 5. The fix report resolved for this run — an unknown id renders the empty
  //    state instead, which would fail here rather than pass quietly.
  const report = page.getByRole('article', { name: 'Fix report' });
  await expect(report).toBeVisible();
  const title = await page.getByRole('heading', { level: 1 }).innerText();
  expect(title.trim().length).toBeGreaterThan(0);

  // 6. Copy the report. THIS is why the context holds clipboard permissions.
  const copy = page.getByRole('button', { name: 'Copy report' });
  await copy.click();
  await expect(copy).toContainText('COPIED');

  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  // The export is module 6's OWN Markdown since #103 wired the real generator,
  // not the hand-rolled string this test was first written against. Retargeted
  // to the real output rather than relaxed: the same five facts are asserted,
  // and the offending-step line is now stricter (it must carry a step number).
  expect(clipboard).toMatch(/^# Fix report · ASI\d\d · /m);
  expect(clipboard).toContain(title.trim());
  // Telemetry an engineer needs in the ticket: which run, which step, the fix.
  expect(clipboard).toMatch(/\*\*Run:\*\* /);
  expect(clipboard).toMatch(/\*\*Offending step:\*\* #\d+ /);
  expect(clipboard).toContain('## Remediation');
});
