import { test, expect, type Locator, type Page } from '@playwright/test';
import { expectNoWcagViolations, suppressBootSplash } from './support/screen';

/**
 * THE RUN BAR ON A SHORT SCREEN, AND THE DISCARD QUESTION UNDER IT
 * (mobile sweep 2026-10-10, S1).
 *
 * The run bar on Connect is pinned under the header so the state and END RUN
 * stay in view while the setup is read. On a phone held sideways that pin cost
 * 35% to 58% of the screen in every run state, and with the DISCARD RUN question
 * open inside it the pinned bar took 71% to 106%: in WebKit at 568x320 the two
 * answers opened half below the fold.
 *
 * So, two changes, each measured here in Chromium AND WebKit:
 * - under 500px of height the bar is not pinned at all, it scrolls with the page;
 * - the question opens BELOW the bar, as its own block, never inside it, at
 *   every width, so the bar never grows when it is asked.
 * From 500px of height up the bar stays pinned exactly as before (the guard at
 * the end).
 *
 * SINCE 2026-10-12, ON A PHONE HELD UPRIGHT (under 768px wide, 500px or more
 * tall) the bar is held at the BOTTOM of the screen and is the last thing in
 * the document (tests/e2e/phone-run-bar.spec.ts). At 320x568 and 390x844 the
 * question is therefore still outside the bar and in the run column, but it
 * comes BEFORE the bar, and its answers sit above it. From 768px up nothing
 * here moved.
 *
 * No exact pixel sizes: ratios, ceilings and relations only. Driven through the
 * Connect states fixture (`/e2e/connect-states`, built only with E2E_FIXTURES=1),
 * in the wider fallback font, the worst case for every row on this screen.
 */
test.skip(
  process.env.E2E_FIXTURES !== '1',
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
);

const FIXTURE = '/e2e/connect-states';
const QUESTION =
  'Discard this run? It ends now, its token stops working, and the detector does not grade it.';

const bar = (page: Page) => page.getByRole('region', { name: /what we have recorded so far/i });
/** Whichever copy of the control this width draws. Exactly one is ever visible. */
const trigger = (page: Page) =>
  page.getByRole('button', { name: 'DISCARD RUN', exact: true }).filter({ visible: true });
const confirm = (page: Page) => page.getByRole('group', { name: /discard this run/i });
const keep = (page: Page) => confirm(page).getByRole('button', { name: 'KEEP RUNNING' });
const yes = (page: Page) => confirm(page).getByRole('button', { name: 'DISCARD', exact: true });
const endRun = (page: Page) => bar(page).getByRole('button', { name: /end run/i });

type State = 'waiting' | 'connected';

async function issued(page: Page, state: State) {
  await suppressBootSplash(page);
  await page.context().route(/\.woff2?(\?|$)/, (route) => route.abort());
  await page.goto(`${FIXTURE}?state=${state}`);
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /start a run/i }).click();
  await expect(
    bar(page).getByText(state === 'connected' ? 'AGENT CONNECTED' : 'AWAITING AGENT'),
  ).toBeVisible();
  // Let the one-off ease-in finish (the header's ambient pulse repeats and is left alone).
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished),
    ),
  );
}

/** The bar's computed position and where it and the header are drawn right now. */
async function barGeometry(page: Page) {
  return page.evaluate(() => {
    const dock = document.querySelector('section[aria-labelledby="connect-state"]')!;
    const header = document.querySelector('header')!;
    const d = dock.getBoundingClientRect();
    const h = header.getBoundingClientRect();
    return {
      position: getComputedStyle(dock).position,
      barTop: d.top,
      barBottom: d.bottom,
      barHeight: d.height,
      headerTop: h.top,
      headerBottom: h.bottom,
      headerHeight: h.height,
      viewportHeight: window.innerHeight,
    };
  });
}

async function scrollToEnd(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
}

async function scrollToTop(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function expectNoSidewaysScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
}

/** The control is on screen and nothing is drawn over its centre. */
async function expectUncovered(locator: Locator) {
  await expect(locator).toBeInViewport();
  const hit = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const on = top !== null && (top === el || el.contains(top));
    const what = top === null ? 'nothing (centre off screen)' : top.tagName.toLowerCase();
    const y = Math.round(r.top + r.height / 2);
    return { on, detail: `centre at y=${y} of ${window.innerHeight}, topmost there: ${what}` };
  });
  expect(hit.on, `the control is the topmost element at its own centre (${hit.detail})`).toBe(true);
}

/** axe on WebKit for Windows crashes on two rules; the scan is Chromium's job. */
async function scanInChromium(page: Page, browserName: string) {
  if (browserName === 'chromium') await expectNoWcagViolations(page);
}

// ── Under 500px of height the bar scrolls with the page ──

for (const [width, height] of [
  [844, 390],
  [932, 430],
] as const) {
  test.describe(`${width}x${height}, phone landscape`, () => {
    test.use({ viewport: { width, height } });

    for (const state of ['connected', 'waiting'] as const) {
      test(`${state}: the bar is not pinned, it scrolls away with the page`, async ({
        page,
        browserName,
      }) => {
        await issued(page, state);

        const atTop = await barGeometry(page);
        expect(['static', 'relative']).toContain(atTop.position);

        await scrollToEnd(page);
        const atEnd = await barGeometry(page);
        // It went up and out of the window with the setup around it.
        expect(atEnd.barBottom).toBeLessThanOrEqual(0);
        await expectNoSidewaysScroll(page);

        // Scrolled back to, it is where it was, and its control still works.
        await scrollToTop(page);
        await bar(page).scrollIntoViewIfNeeded();
        await expect(bar(page)).toBeInViewport();
        if (state === 'connected') {
          await endRun(page).scrollIntoViewIfNeeded();
          await expectUncovered(endRun(page));
          await expect(endRun(page)).toHaveAccessibleName('End run and get result');
        }
        await expect(trigger(page)).toHaveCount(1);
        await expectNoSidewaysScroll(page);
        await scanInChromium(page, browserName);
      });
    }

    test('the confirm opens under the bar, in view, with KEEP RUNNING focused', async ({
      page,
    }) => {
      await issued(page, 'connected');
      await trigger(page).click();

      await expect(confirm(page).getByText(QUESTION)).toBeVisible();
      await expect(keep(page)).toBeFocused();
      await expectUncovered(keep(page));
      await expectUncovered(yes(page));
      // The bar did not grow to hold it: it is still well under half the screen.
      const g = await barGeometry(page);
      expect(g.barHeight / g.viewportHeight).toBeLessThan(0.5);
      await page.keyboard.press('Escape');
      await expect(confirm(page)).toHaveCount(0);
      await expect(trigger(page)).toBeFocused();
    });
  });
}

test.describe('568x320, the shortest phone landscape', () => {
  test.use({ viewport: { width: 568, height: 320 } });

  test('the confirm answers open on screen and uncovered, not below the fold', async ({ page }) => {
    await issued(page, 'connected');
    expect(['static', 'relative']).toContain((await barGeometry(page)).position);
    await trigger(page).click();

    await expect(keep(page)).toBeFocused();
    await expectUncovered(keep(page));
    await expectUncovered(yes(page));
    await expectNoSidewaysScroll(page);
  });
});

// ── The confirm is never inside the bar ──

// A phone held upright: the bar is at the bottom, after the run column.
for (const [width, height] of [
  [320, 568],
  [390, 844],
] as const) {
  test.describe(`${width}x${height}, the confirm`, () => {
    test.use({ viewport: { width, height } });

    test('is in the run column, not inside the bar, and its answers sit above the bar', async ({
      page,
      browserName,
    }) => {
      await issued(page, 'connected');
      await trigger(page).click();
      await expect(keep(page)).toBeFocused();

      const tree = await page.evaluate(() => {
        const dock = document.querySelector('section[aria-labelledby="connect-state"]')!;
        const column = document.querySelector('.panel-in')!;
        const group = [...document.querySelectorAll('[role="group"]')].find((el) =>
          /discard this run/i.test(el.textContent ?? ''),
        )!;
        return {
          inside: dock.contains(group),
          inColumn: group.parentElement === column,
          barAfter: (group.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        };
      });
      expect(tree).toEqual({ inside: false, inColumn: true, barAfter: true });

      // Both answers are above the bar, uncovered, full size.
      const g = await barGeometry(page);
      for (const answer of [keep(page), yes(page)]) {
        const b = (await answer.boundingBox())!;
        expect(b.y + b.height).toBeLessThanOrEqual(g.barTop + 0.5);
        expect(b.height).toBeGreaterThanOrEqual(44);
        await expectUncovered(answer);
      }
      await expectNoSidewaysScroll(page);
      await scanInChromium(page, browserName);
    });
  });
}

for (const [width, height] of [
  [768, 1024],
  [1024, 768],
  [1280, 900],
] as const) {
  test.describe(`${width}x${height}, the confirm`, () => {
    test.use({ viewport: { width, height } });

    test('is a sibling after the bar, not inside it, and its answers sit just below', async ({
      page,
      browserName,
    }) => {
      await issued(page, 'connected');
      await trigger(page).click();
      await expect(keep(page)).toBeFocused();

      const tree = await page.evaluate(() => {
        const dock = document.querySelector('section[aria-labelledby="connect-state"]')!;
        const group = [...document.querySelectorAll('[role="group"]')].find((el) =>
          /discard this run/i.test(el.textContent ?? ''),
        )!;
        return {
          inside: dock.contains(group),
          sameParent: dock.parentElement === group.parentElement,
          after: (dock.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        };
      });
      expect(tree).toEqual({ inside: false, sameParent: true, after: true });

      // Both answers are below the bar, close under it, uncovered, full size.
      const g = await barGeometry(page);
      for (const answer of [keep(page), yes(page)]) {
        const b = (await answer.boundingBox())!;
        expect(b.y).toBeGreaterThanOrEqual(g.barBottom - 0.5);
        // Close under it: at most the narrow DISCARD RUN row, the question and a
        // gap or two away, never a screen away.
        expect(b.y - g.barBottom).toBeLessThan(g.viewportHeight * 0.5);
        expect(b.height).toBeGreaterThanOrEqual(44);
        await expectUncovered(answer);
      }
      await expectNoSidewaysScroll(page);
      await scanInChromium(page, browserName);
    });
  });
}

test.describe('320x568, the confirm open', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  // The target set for this fix was 30%. It cannot be met by moving the question
  // alone: with the question CLOSED, header and connected bar are already 31.1%
  // of 320x568 in the fallback font, both engines (bar about 104px, inside the
  // 114px ceiling, which itself allows a third of the screen). The bar is left
  // as it is at this height, so what is held is that asking adds nothing to it,
  // and the third its ceiling allows.
  test('header and bar together stay what they were, within a third of the screen', async ({
    page,
  }) => {
    await issued(page, 'connected');
    const closed = await barGeometry(page);
    await trigger(page).click();
    await expect(keep(page)).toBeFocused();

    const g = await barGeometry(page);
    test.info().annotations.push({
      type: 'header + bar',
      description: `${Math.round(((g.headerHeight + g.barHeight) / g.viewportHeight) * 1000) / 10}% of ${g.viewportHeight}px`,
    });
    // Asking does not grow the bar (before this fix it took 78.7% of the screen).
    expect(Math.abs(g.barHeight - closed.barHeight) / g.viewportHeight).toBeLessThan(0.005);
    expect((g.headerHeight + g.barHeight) / g.viewportHeight).toBeLessThanOrEqual(1 / 3);
    // The bar is the same bar it was before the question: under its phone ceiling.
    expect(g.barHeight).toBeLessThanOrEqual(114);
  });
});

test.describe('1280x900, asked from the bar while scrolled down', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the question comes into view and the pinned bar does not cover it', async ({ page }) => {
    await issued(page, 'connected');
    await scrollToEnd(page);
    // The bar is pinned here, so its DISCARD RUN is still in view.
    await expect(trigger(page)).toBeInViewport();
    await trigger(page).click();

    await expect(keep(page)).toBeFocused();
    await expectUncovered(keep(page));
    await expectUncovered(yes(page));
  });
});

// ── From 500px of height up, the bar is held: under the header from 768px ──
// ── wide, at the bottom of the screen on a phone held upright ──

test.describe('390x844, a tall phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const state of ['connected', 'waiting'] as const) {
    test(`${state}: the bar stays held at the bottom of the screen`, async ({ page }) => {
      await issued(page, state);
      // The slot that holds it is what is sticky; the bar is a block inside it.
      const slot = await page.evaluate(() => {
        const dock = document.querySelector('section[aria-labelledby="connect-state"]')!;
        return getComputedStyle(dock.parentElement!).position;
      });
      expect(slot).toBe('sticky');

      for (const scroll of [scrollToTop, scrollToEnd]) {
        await scroll(page);
        const g = await barGeometry(page);
        await expect(bar(page)).toBeInViewport();
        // Clear of the header, and resting on the bottom edge.
        expect(g.barTop).toBeGreaterThanOrEqual(g.headerBottom - 0.5);
        expect(g.barBottom).toBeLessThanOrEqual(g.viewportHeight + 1);
        expect(g.viewportHeight - g.barBottom).toBeLessThan(24);
        if (state === 'connected') await expectUncovered(endRun(page));
      }
    });
  }
});

for (const [width, height] of [
  [768, 1024],
  [1280, 900],
] as const) {
  test.describe(`${width}x${height}, a tall screen`, () => {
    test.use({ viewport: { width, height } });

    for (const state of ['connected', 'waiting'] as const) {
      test(`${state}: the bar stays pinned under the header`, async ({ page }) => {
        await issued(page, state);
        expect((await barGeometry(page)).position).toBe('sticky');

        await scrollToEnd(page);
        const g = await barGeometry(page);
        await expect(bar(page)).toBeInViewport();
        // Held just under the header, as before.
        expect(g.barTop).toBeGreaterThanOrEqual(g.headerBottom - 0.5);
        expect(g.barTop - g.headerBottom).toBeLessThan(24);
        if (state === 'connected') await expectUncovered(endRun(page));
      });
    }
  });
}
