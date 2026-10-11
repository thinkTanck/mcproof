import { test, expect, type Locator, type Page } from '@playwright/test';
import { expectNoWcagViolations, suppressBootSplash } from './support/screen';

/**
 * DISCARD RUN, MEASURED IN A REAL BROWSER.
 *
 * A run a person drove by hand is not a test, and DISCARD RUN is how they end
 * it without asking the judge. Where the control sits depends on media queries,
 * which jsdom does not apply, so this runs in Chromium against the Connect
 * states fixture (`/e2e/connect-states`, built only with E2E_FIXTURES=1).
 *
 * At 1280 the control is in the pinned bar beside END RUN AND JUDGE. At 320 it
 * cannot be: the count and END RUN already fill the bar's second row, and a
 * third row would undo the ceiling the bar was given in the 2026-10-07 sweep
 * (tests/e2e/connected-run-bar.spec.ts). So on a narrow screen it sits directly
 * under the bar, full size, and the bar itself is unchanged.
 *
 * No exact pixel sizes: ceilings, floors and relations only.
 */
test.skip(
  process.env.E2E_FIXTURES !== '1',
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
);

const FIXTURE = '/e2e/connect-states';
const QUESTION = 'Discard this run? It ends now, its token stops working, and it is not judged.';

const bar = (page: Page) => page.getByRole('region', { name: /what we have actually seen/i });
/** Whichever copy of the control this width draws. Exactly one is ever visible. */
const trigger = (page: Page) =>
  page.getByRole('button', { name: 'DISCARD RUN', exact: true }).filter({ visible: true });
const confirm = (page: Page) => bar(page).getByRole('group', { name: /discard this run/i });
const keep = (page: Page) => confirm(page).getByRole('button', { name: 'KEEP RUNNING' });
const yes = (page: Page) => confirm(page).getByRole('button', { name: 'DISCARD', exact: true });
const endRun = (page: Page) => bar(page).getByRole('button', { name: /end run/i });
const fresh = (page: Page) => bar(page).getByRole('button', { name: /fresh run|new run/i });

async function issued(page: Page, state: 'waiting' | 'connected') {
  await suppressBootSplash(page);
  // The wider fallback font is the worst case for every row on this screen.
  await page.context().route(/\.woff2?(\?|$)/, (route) => route.abort());
  await page.goto(`${FIXTURE}?state=${state}`);
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /issue run endpoint/i }).click();
  await expect(
    bar(page).getByText(state === 'connected' ? 'AGENT CONNECTED' : 'AWAITING AGENT'),
  ).toBeVisible();
  // The issued run eases in once (`panel-in`). axe reads COMPUTED colour, so a
  // scan taken mid-fade measures half-transparent text and reports contrast no
  // reader ever sees. Wait for every animation that ends to end first (the
  // header's ambient pulse repeats for ever and is left alone).
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished),
    ),
  );
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error('not drawn');
  return { ...b, right: b.x + b.width, bottom: b.y + b.height };
}

/** Nothing on the page is wider than the screen. */
async function expectNoSidewaysScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
}

async function expectInsideViewport(page: Page, locator: Locator) {
  const b = await box(locator);
  const width = page.viewportSize()!.width;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.right).toBeLessThanOrEqual(width + 0.5);
}

test.describe('1280x900', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("DISCARD RUN is in the pinned bar, in END RUN AND JUDGE's row, and both are full size", async ({
    page,
  }) => {
    await issued(page, 'connected');
    await expect(trigger(page)).toHaveCount(1);

    const [d, e, b] = await Promise.all([box(trigger(page)), box(endRun(page)), box(bar(page))]);
    // Inside the bar.
    expect(d.x).toBeGreaterThanOrEqual(b.x);
    expect(d.right).toBeLessThanOrEqual(b.right + 0.5);
    expect(d.y).toBeGreaterThanOrEqual(b.y);
    expect(d.bottom).toBeLessThanOrEqual(b.bottom + 0.5);
    // One row, side by side, not overlapping. END RUN, the primary, is last.
    expect(d.y).toBeLessThan(e.bottom);
    expect(d.bottom).toBeGreaterThan(e.y);
    expect(d.right).toBeLessThanOrEqual(e.x + 0.5);
    expect(d.height).toBeGreaterThanOrEqual(44);
    expect(e.height).toBeGreaterThanOrEqual(44);
    // The bar is still one row tall.
    expect(b.height).toBeLessThan(90);
    await expectNoWcagViolations(page);
  });

  test('is offered on a run nobody has connected to', async ({ page }) => {
    await issued(page, 'waiting');

    await expect(trigger(page)).toHaveCount(1);
    await expect(endRun(page)).toHaveCount(0);
    const [d, b] = await Promise.all([box(trigger(page)), box(bar(page))]);
    expect(d.y).toBeGreaterThanOrEqual(b.y);
    expect(d.bottom).toBeLessThanOrEqual(b.bottom + 0.5);
    expect(d.height).toBeGreaterThanOrEqual(44);
  });

  test('the confirm takes focus on KEEP RUNNING, Escape cancels, and focus comes back', async ({
    page,
  }) => {
    await issued(page, 'connected');
    await trigger(page).focus();
    await page.keyboard.press('Enter');

    await expect(confirm(page).getByText(QUESTION)).toBeVisible();
    await expect(keep(page)).toBeFocused();
    for (const control of [keep(page), yes(page)]) {
      expect((await box(control)).height).toBeGreaterThanOrEqual(44);
    }
    await expectNoWcagViolations(page);

    await page.keyboard.press('Escape');
    await expect(confirm(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
    await expect(bar(page).getByText('AGENT CONNECTED')).toBeVisible();
  });

  test('confirming reads RUN DISCARDED with ISSUE A FRESH RUN, and nothing to judge', async ({
    page,
  }) => {
    await issued(page, 'connected');
    await trigger(page).click();
    await yes(page).click();

    await expect(bar(page).getByText('RUN DISCARDED')).toBeVisible();
    await expect(fresh(page)).toBeVisible();
    await expect(fresh(page)).toBeFocused();
    await expect(fresh(page)).toHaveText(/ISSUE A FRESH RUN/);
    await expect(endRun(page)).toHaveCount(0);
    await expect(trigger(page)).toHaveCount(0);
    await expect(page.getByText('This run was discarded and not judged.').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /open the replay/i })).toHaveCount(0);
    expect((await box(fresh(page))).height).toBeGreaterThanOrEqual(44);
    expect((await box(bar(page))).height).toBeLessThan(90);
    await expectNoWcagViolations(page);

    await fresh(page).click();
    await expect(page.getByRole('button', { name: /issue run endpoint/i })).toBeVisible();
  });
});

test.describe('320x568', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('DISCARD RUN sits directly under the bar, full size, and the bar keeps its ceiling', async ({
    page,
  }) => {
    await issued(page, 'connected');
    await expect(trigger(page)).toHaveCount(1);

    const [d, b] = await Promise.all([box(trigger(page)), box(bar(page))]);
    // Under the bar, not in it, with nothing but a gap between them.
    expect(d.y).toBeGreaterThanOrEqual(b.bottom - 0.5);
    expect(d.y - b.bottom).toBeLessThan(40);
    expect(d.height).toBeGreaterThanOrEqual(44);
    expect(d.width).toBeGreaterThanOrEqual(44);
    await expectInsideViewport(page, trigger(page));
    // The same ceiling tests/e2e/connected-run-bar.spec.ts holds the bar to.
    expect(b.height).toBeLessThanOrEqual(114);
    await expect(endRun(page)).toBeVisible();
    await expectNoSidewaysScroll(page);
    await expectNoWcagViolations(page);
  });

  test('is offered under the bar on a run nobody has connected to', async ({ page }) => {
    await issued(page, 'waiting');

    await expect(trigger(page)).toHaveCount(1);
    expect((await box(trigger(page))).height).toBeGreaterThanOrEqual(44);
    await expectInsideViewport(page, trigger(page));
    await expectNoSidewaysScroll(page);
  });

  test('the confirm fits the screen, takes focus, and cancels back to the control', async ({
    page,
  }) => {
    await issued(page, 'connected');
    await trigger(page).click();

    await expect(confirm(page).getByText(QUESTION)).toBeVisible();
    await expect(keep(page)).toBeFocused();
    for (const control of [keep(page), yes(page)]) {
      expect((await box(control)).height).toBeGreaterThanOrEqual(44);
      await expectInsideViewport(page, control);
    }
    await expectInsideViewport(page, confirm(page));
    await expectNoSidewaysScroll(page);
    await expectNoWcagViolations(page);

    await keep(page).click();
    await expect(confirm(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
    // Cancelled: the bar is back under its ceiling.
    expect((await box(bar(page))).height).toBeLessThanOrEqual(114);
  });

  test('confirming reads RUN DISCARDED with a fresh run, inside the screen', async ({ page }) => {
    await issued(page, 'connected');
    await trigger(page).click();
    await yes(page).click();

    await expect(bar(page).getByText('RUN DISCARDED')).toBeVisible();
    await expect(fresh(page)).toBeVisible();
    await expect(fresh(page)).toBeFocused();
    expect((await box(fresh(page))).height).toBeGreaterThanOrEqual(44);
    await expectInsideViewport(page, fresh(page));
    await expect(trigger(page)).toHaveCount(0);
    // An ended run's bar wraps its count under the label on a phone, as a
    // finished run's does, so it is held to a looser ceiling than the open
    // bar's 114: under 30% of this screen.
    expect((await box(bar(page))).height).toBeLessThan(170);
    await expectNoSidewaysScroll(page);
    await expectNoWcagViolations(page);
  });
});

/**
 * THE DISCARDED STATE OF `/runs/[id]` AND `/findings/[id]`. A real one needs a
 * signed-in owner and a stored row, which CI has neither of, so the fixture
 * renders the same component those two pages render for it.
 */
for (const [width, height] of [
  [1280, 900],
  [320, 568],
] as const) {
  test.describe(`the discarded state page at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const surface of ['run-discarded', 'report-discarded'] as const) {
      test(`${surface}: one plain sentence, an inert badge, a full-size way on`, async ({
        page,
      }) => {
        await suppressBootSplash(page);
        await page.goto(`${FIXTURE}?state=${surface}`);

        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          'This run was discarded and not judged.',
        );
        await expect(page.getByText('RUN DISCARDED', { exact: true })).toBeVisible();
        const link = page.getByRole('link', { name: /connect your agent/i });
        expect((await box(link)).height).toBeGreaterThanOrEqual(44);
        await expectInsideViewport(page, link);
        await expectNoSidewaysScroll(page);
        await expectNoWcagViolations(page);
      });
    }
  });
}
