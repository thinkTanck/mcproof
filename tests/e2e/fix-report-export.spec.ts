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
  // Dates and labels (owner ruling 2026-10-14): the screen reads human dates,
  // the copied ticket keeps the ISO provenance line. So the two are compared by
  // what they say, not byte for byte.
  const shown = provenance.match(
    /^constructed demonstration · .*(?:verdict recorded|constructed and judged) (\w{3}) (\d{1,2}), (\d{4})/,
  );
  expect(shown, 'the page names the day the verdict was recorded').not.toBeNull();

  const caveat = page.getByTestId('classification-caveat').locator('p');
  const sentence = (await caveat.nth(0).innerText()).trim();
  const measured = (await caveat.nth(1).innerText()).trim();
  expect(sentence).toMatch(/named the right type \d+ of \d+ times/);

  const copy = page.getByRole('button', { name: 'Copy report' });
  await copy.click();
  await expect(copy).toContainText('COPIED');
  const clipboard = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r/g, '');

  const ticketLine = clipboard
    .split('\n')
    .find((line) => line.includes('constructed demonstration'));
  expect(ticketLine, 'the ticket carries the provenance line').toBeTruthy();
  const iso = ticketLine!.match(/(\d{4})-(\d{2})-(\d{2})/);
  expect(iso, 'the ticket keeps the ISO date').not.toBeNull();
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  expect(
    [MONTHS[Number(iso![2]) - 1], String(Number(iso![3])), iso![1]],
    'the same day as the page',
  ).toEqual([shown![1], shown![2], shown![3]]);
  expect(clipboard, 'the classification caveat shown on the page').toContain(sentence);
  // The caveat's provenance reads in plain words on the page and as the
  // frozen ISO line in the ticket (copy pass, 2026-10-15): the same day.
  const shownDay = measured.match(/measured (\w{3}) (\d{1,2}), (\d{4})/);
  expect(shownDay, 'the page names the day the attack type was measured').not.toBeNull();
  const measuredLine = clipboard.split('\n').find((line) => line.startsWith('_Measured:_'));
  const measuredIso = measuredLine?.match(/(\d{4})-(\d{2})-(\d{2})/);
  expect(measuredIso, 'the ticket keeps the ISO measurement line').toBeTruthy();
  expect([
    MONTHS[Number(measuredIso![2]) - 1],
    String(Number(measuredIso![3])),
    measuredIso![1],
  ]).toEqual([shownDay![1], shownDay![2], shownDay![3]]);
  // The caveat is read before the list it qualifies.
  expect(clipboard.indexOf(sentence)).toBeLessThan(clipboard.indexOf('\n1. '));
});
