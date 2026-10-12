import { test, expect, type Locator, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE PINNED RUN BAR SITS UNDER THE HEADER'S REAL HEIGHT.
 *
 * With the text enlarged the shared header can grow past `--header-h` (its
 * controls are rem-sized, and on a phone the mode chip may take a second row).
 * The run bar on Connect is pinned under the header, and it used to be pinned
 * at `--header-h` plus 8px whatever the header's real height, so the taller
 * header was drawn over the top of the bar, and over the controls the bar and
 * the page scroll focus to.
 *
 * Measured on the Connect states fixture (built only with E2E_FIXTURES=1), in
 * Chromium and WebKit, in the wider fallback font, at 320 and 390 wide:
 *
 *  - with the root font size at 200%, once the page is scrolled so the bar is
 *    pinned, the bar starts at or below the header's bottom, while a run is
 *    awaiting its agent and once it is connected;
 *  - with the discard confirm open, DISCARD and KEEP RUNNING are each the
 *    element actually drawn at their own centre when focused, so neither the
 *    header nor the bar covers them;
 *  - at normal text size the pinned bar still starts just under the header, as
 *    it always has (a structural check with a small tolerance).
 *
 * No exact pixel sizes: relations and small tolerances only.
 *
 * SINCE 2026-10-12 A PHONE HELD UPRIGHT HOLDS THE BAR AT THE BOTTOM of the
 * screen (tests/e2e/phone-run-bar.spec.ts), so at 320 and 390 the bar is no
 * longer pinned under the header at all. What these two sizes still hold: the
 * bar starts below the header at 200%, the discard answers are not covered, and
 * at normal size the bar rests on the bottom edge. The bar is still pinned
 * under the header's measured height from 768px up, so that is where the pin
 * itself is now measured (the tablet block at the end).
 */
test.skip(
  process.env.E2E_FIXTURES !== '1',
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
);

const PHONES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

/** Sub-pixel rounding. */
const TOLERANCE = 1;

const bar = (page: Page) => page.getByRole('region', { name: /what we have actually seen/i });

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function issue(page: Page, state: 'waiting' | 'connected') {
  await suppressBootSplash(page);
  await page.context().route(/\.woff2?(\?|$)/, (route) => route.abort());
  await page.goto(`/e2e/connect-states?state=${state}`);
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /issue run endpoint/i }).click();
  await expect(
    bar(page).getByText(state === 'connected' ? 'AGENT CONNECTED' : 'AWAITING AGENT'),
  ).toBeVisible();
  await settle(page);
}

async function enlarge(page: Page) {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await settle(page);
}

/** Scroll far enough that the bar has left its place in the flow and is pinned. */
async function pinTheBar(page: Page) {
  await page.evaluate(() => {
    const section = document.querySelector('section[aria-labelledby="connect-state"]')!;
    window.scrollTo(0, section.getBoundingClientRect().top + window.scrollY + 600);
  });
  await settle(page);
}

async function headerBottomAndBarTop(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector('header')!.getBoundingClientRect();
    const section = document
      .querySelector('section[aria-labelledby="connect-state"]')!
      .getBoundingClientRect();
    return { headerBottom: header.bottom, barTop: section.top };
  });
}

/** Is the element drawn at the control's centre the control itself, or inside it? */
function onTop(control: Locator): Promise<{ ok: boolean; found: string }> {
  return control.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const name = (n: Element | null) =>
      n ? `${n.tagName.toLowerCase()}.${[...n.classList].slice(0, 3).join('.')}` : 'nothing';
    return { ok: hit !== null && (hit === el || el.contains(hit)), found: name(hit) };
  });
}

for (const viewport of PHONES) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const state of ['waiting', 'connected'] as const) {
      test(`root 200%, ${state}: the pinned bar starts below the header`, async ({ page }) => {
        await issue(page, state);
        await enlarge(page);
        await pinTheBar(page);
        const { headerBottom, barTop } = await headerBottomAndBarTop(page);
        expect(barTop, 'bar top vs header bottom').toBeGreaterThanOrEqual(headerBottom - TOLERANCE);
      });

      test(`normal size, ${state}: the bar rests on the bottom edge, clear of the header`, async ({
        page,
      }) => {
        await issue(page, state);
        await pinTheBar(page);
        const { headerBottom, barTop } = await headerBottomAndBarTop(page);
        expect(barTop, 'bar top vs header bottom').toBeGreaterThanOrEqual(headerBottom - TOLERANCE);
        const fromBottom = await page.evaluate(
          () =>
            window.innerHeight -
            document
              .querySelector('section[aria-labelledby="connect-state"]')!
              .getBoundingClientRect().bottom,
        );
        expect(Math.abs(fromBottom)).toBeLessThanOrEqual(TOLERANCE);
      });
    }

    test('root 200%, discard confirm open: DISCARD and KEEP RUNNING are not covered', async ({
      page,
    }) => {
      await issue(page, 'waiting');
      await enlarge(page);
      await page
        .getByRole('button', { name: 'DISCARD RUN', exact: true })
        .filter({ visible: true })
        .click();
      const keep = page.getByRole('button', { name: 'KEEP RUNNING' });
      const discard = page.getByRole('button', { name: 'DISCARD', exact: true });
      // Focus lands on KEEP RUNNING when the confirm opens, and the browser
      // scrolls it into view; DISCARD is one step back in the tab order.
      await expect(keep).toBeFocused();
      await settle(page);
      const k = await onTop(keep);
      expect(k.ok, `KEEP RUNNING is under ${k.found}`).toBe(true);
      await page.keyboard.press('Shift+Tab');
      await expect(discard).toBeFocused();
      await settle(page);
      const d = await onTop(discard);
      expect(d.ok, `DISCARD is under ${d.found}`).toBe(true);
    });
  });
}

// ── From 768px up the bar is still pinned under the header's measured height ──

test.describe('at 768x1024, where the bar is pinned under the header', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  for (const state of ['waiting', 'connected'] as const) {
    test(`root 200%, ${state}: the pinned bar starts below the header`, async ({ page }) => {
      await issue(page, state);
      await enlarge(page);
      await pinTheBar(page);
      const { headerBottom, barTop } = await headerBottomAndBarTop(page);
      expect(barTop, 'bar top vs header bottom').toBeGreaterThanOrEqual(headerBottom - TOLERANCE);
      // Pinned there, not merely somewhere lower on the screen.
      expect(barTop - headerBottom).toBeLessThanOrEqual(8 * 2 + TOLERANCE);
    });

    test(`normal size, ${state}: the pinned bar sits just under the header`, async ({ page }) => {
      await issue(page, state);
      await pinTheBar(page);
      const { headerBottom, barTop } = await headerBottomAndBarTop(page);
      // The 8px gap it has always had, give or take a pixel.
      expect(barTop - headerBottom).toBeGreaterThanOrEqual(8 - TOLERANCE);
      expect(barTop - headerBottom).toBeLessThanOrEqual(8 + TOLERANCE);
    });
  }
});
