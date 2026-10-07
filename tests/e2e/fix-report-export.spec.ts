import { test, expect } from '@playwright/test';
import { gotoOk, suppressBootSplash } from './support/screen';

/**
 * THE COPIED FIX REPORT SAYS WHAT THE SCREEN SAYS.
 *
 * `/findings/sample` shows the line that says the run is a constructed
 * demonstration, and above the remediation list it states the measured
 * classification accuracy the list depends on. The 2026-10-07 sweep copied the
 * report and found neither in the clipboard, so a pasted ticket read as a real
 * finding with unqualified guidance.
 *
 * Both strings are read OFF THE PAGE and then looked for in the clipboard, so
 * this test holds no copy of either and cannot drift from the screen.
 */
test.beforeEach(async ({ page }) => {
  await suppressBootSplash(page);
});

test('/findings/sample: Copy report puts the provenance line on the clipboard', async ({
  page,
}) => {
  await gotoOk(page, '/findings/sample');

  const provenance = (
    await page
      .getByRole('article', { name: 'Fix report' })
      .getByText(/constructed demonstration/)
      .innerText()
  ).trim();
  expect(provenance).toMatch(/^constructed demonstration · recorded validated-judge verdict · /);

  const caveat = page.getByTestId('classification-caveat').locator('p');
  const sentence = (await caveat.nth(0).innerText()).trim();
  const measured = (await caveat.nth(1).innerText()).trim();
  expect(sentence).toMatch(/Measured accuracy on our labeled set is 0\.68/);

  const copy = page.getByRole('button', { name: 'Copy report' });
  await copy.click();
  await expect(copy).toContainText('COPIED');
  const clipboard = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r/g, '');

  expect(clipboard, 'the provenance line shown on the page').toContain(provenance);
  expect(clipboard, 'the classification caveat shown on the page').toContain(sentence);
  expect(clipboard, 'the caveat provenance line shown on the page').toContain(measured);
  // The caveat is read before the list it qualifies.
  expect(clipboard.indexOf(sentence)).toBeLessThan(clipboard.indexOf('\n1. '));
});
