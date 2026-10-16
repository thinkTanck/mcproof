import {
  test,
  expect,
  devices,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE RUN BAR STAYS ON SCREEN ON A PHONE, AND THE PAGE SCROLLS.
 *
 * Reported from a real iPhone: on Connect the run bar was not on screen when
 * the page opened, and a swipe that started on a dark scrolling box moved the
 * box and not the page.
 *
 * What was measured before this change (both engines, normal text):
 *  - the bar was pinned under the header, which only holds it once the page
 *    has been scrolled PAST its place in the flow. A page opened or reloaded
 *    with a run sits at its top, and the bar was 2300 to 3250px further down;
 *    in WebKit it also appeared one pixel below the fold right after ISSUE RUN
 *    ENDPOINT was pressed;
 *  - the replay terminal on /runs/sample was 62% to 70% of the screen with its
 *    own vertical scroll, so most swipes started on it and moved it instead of
 *    the page.
 *
 * So on a phone held upright (under 768px wide, at least 500px tall):
 *  - the run bar is the LAST thing on the Connect page, and it is held at the
 *    bottom of the screen until the reader reaches it;
 *  - no scrolling box is taller than half the screen, a scroll that starts on
 *    one at its end moves the page, and so does one that starts beside it.
 * From 768px up, and on a phone held sideways, nothing moved.
 *
 * No exact pixel sizes: the viewport's own edges, ratios and ceilings only.
 * Chromium AND WebKit. Driven through the Connect states fixture
 * (`/e2e/connect-states`, built only with E2E_FIXTURES=1), in the wider
 * fallback font, the worst case for every row on this screen.
 */
test.skip(
  process.env.E2E_FIXTURES !== '1',
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
);

const FIXTURE = '/e2e/connect-states';
const PHONES = [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
] as const;
const TEXTS = ['normal', '200%'] as const;
type Text = (typeof TEXTS)[number];
const STATES = [
  'waiting',
  'connected',
  'confirm open',
  'finished',
  'expired',
  'discarded',
] as const;
type State = (typeof STATES)[number];

/** Sub-pixel rounding at an edge. */
const EDGE = 1;

const bar = (page: Page) => page.getByRole('region', { name: /what we have recorded so far/i });
const trigger = (page: Page) =>
  page.getByRole('button', { name: 'DISCARD RUN', exact: true }).filter({ visible: true });
const keep = (page: Page) => page.getByRole('button', { name: 'KEEP RUNNING' });
const yes = (page: Page) => page.getByRole('button', { name: 'DISCARD', exact: true });

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

/** Open the fixture and bring a run to the given state. The test scrolls nothing itself. */
async function reach(page: Page, state: State, text: Text) {
  await suppressBootSplash(page);
  await page.context().route(/\.woff2?(\?|$)/, (route) => route.abort());
  const fixture = state === 'expired' ? 'expired' : state === 'waiting' ? 'waiting' : 'connected';
  await page.goto(`${FIXTURE}?state=${fixture}`);
  if (text === '200%') {
    // Before there is a run, so it is issued and met at the enlarged size.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await settle(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
      '32px',
    );
  }
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /start a run/i }).click();
  await expect(bar(page)).toBeVisible();
  if (state === 'finished') {
    await bar(page)
      .getByRole('button', { name: /end run/i })
      .click();
    await expect(bar(page).getByRole('link', { name: /open the replay/i })).toBeVisible();
  }
  if (state === 'confirm open' || state === 'discarded') {
    await trigger(page).click();
    await expect(keep(page)).toBeFocused();
    if (state === 'discarded') {
      await yes(page).click();
      await expect(bar(page).getByText('RUN DISCARDED')).toBeVisible();
    }
  }
  await settle(page);
}

/** Where the bar is drawn, against the window it is drawn in. */
async function barBox(page: Page) {
  return page.evaluate(() => {
    const dock = document.querySelector('section[aria-labelledby="connect-state"]')!;
    const r = dock.getBoundingClientRect();
    // Rows: the most of the bar's cells (the readings, taken as the one status
    // region they are, and each control) that are stacked one wholly above the
    // next. The readings may wrap inside their own cell beside a control; that
    // is one row, and the height ceiling is what holds it short.
    const pieces = ([...dock.querySelectorAll('[role="status"], button, a')] as HTMLElement[])
      .map((piece) => piece.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0)
      .sort((a, b) => a.bottom - b.bottom);
    let rows = 0;
    let floor = -Infinity;
    for (const b of pieces) {
      if (b.top >= floor - 1) {
        rows += 1;
        floor = b.bottom;
      }
    }
    return {
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      height: r.height,
      rows,
      viewportHeight: window.innerHeight,
      viewportWidth: document.documentElement.clientWidth,
      scrollY: window.scrollY,
    };
  });
}

function expectWhollyOnScreen(b: Awaited<ReturnType<typeof barBox>>, when: string) {
  expect(b.top, `${when}: the bar's top edge is on screen`).toBeGreaterThanOrEqual(-EDGE);
  expect(b.bottom, `${when}: the bar's bottom edge is on screen`).toBeLessThanOrEqual(
    b.viewportHeight + EDGE,
  );
  expect(b.left, `${when}: the bar's left edge is on screen`).toBeGreaterThanOrEqual(-EDGE);
  expect(b.right, `${when}: the bar's right edge is on screen`).toBeLessThanOrEqual(
    b.viewportWidth + EDGE,
  );
  expect(b.height, `${when}: the bar has a height`).toBeGreaterThan(40);
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

// ── The bar is on screen when the page opens ──

for (const viewport of PHONES) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const text of TEXTS) {
      for (const state of STATES) {
        test(`${text} text, ${state}: the bar is wholly on screen before any scroll, and at the top of the page`, async ({
          page,
        }) => {
          await reach(page, state, text);

          // As the reader meets it, the moment the run is in that state.
          expectWhollyOnScreen(await barBox(page), 'as met');

          // As a reload leaves it: the page at its very top, the run far below.
          await page.evaluate(() => window.scrollTo(0, 0));
          await settle(page);
          const atTop = await barBox(page);
          expect(atTop.scrollY).toBe(0);
          expectWhollyOnScreen(atTop, 'at the top of the page');
          // Held at the bottom edge, not floating somewhere in the middle.
          expect(atTop.viewportHeight - atTop.bottom).toBeLessThanOrEqual(EDGE);

          // One bar, and one live region in it.
          await expect(bar(page)).toHaveCount(1);
          await expect(bar(page).getByRole('status')).toHaveCount(1);
        });
      }

      for (const state of ['waiting', 'connected', 'finished', 'expired', 'discarded'] as const) {
        test(`${text} text, ${state}: the bar is at most two rows and about 30% of the screen`, async ({
          page,
        }) => {
          await reach(page, state, text);
          const b = await barBox(page);
          test.info().annotations.push({
            type: 'bar',
            description: `${Math.round((b.height / b.viewportHeight) * 1000) / 10}% of ${b.viewportHeight}px, ${b.rows} row(s)`,
          });

          expect(b.rows).toBeLessThanOrEqual(2);
          // "About 30%", with a little room for a font that sets wider.
          expect(b.height / b.viewportHeight).toBeLessThanOrEqual(0.32);
          // At normal size it is far smaller: a fifth of the screen at most.
          if (text === 'normal') expect(b.height / b.viewportHeight).toBeLessThanOrEqual(0.2);
        });
      }

      for (const state of ['connected', 'confirm open', 'finished'] as const) {
        test(`${text} text, ${state}: at the end of the page the bar covers nothing`, async ({
          page,
        }) => {
          await reach(page, state, text);
          if (state !== 'finished') {
            // Open a client's steps, so the page ends in the setup's code boxes.
            await page
              .getByRole('group', { name: 'MCP client' })
              .getByRole('button')
              .first()
              .click();
          }
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await settle(page);

          const b = await barBox(page);
          expectWhollyOnScreen(b, 'at the end of the page');
          const last = await page.evaluate(() => {
            const dock = document.querySelector('section[aria-labelledby="connect-state"]')!;
            const column = document.querySelector('.panel-in')!;
            // The last things the run column draws: its last element with text,
            // and its last code box where it has one.
            const leaves = [...column.querySelectorAll('*')].filter(
              (el) =>
                !dock.contains(el) &&
                el.children.length === 0 &&
                (el.textContent ?? '').trim() !== '' &&
                el.getBoundingClientRect().height > 0,
            );
            const code = [...column.querySelectorAll('pre')].filter((el) => !dock.contains(el));
            const bottom = (el: Element | undefined) =>
              el ? el.getBoundingClientRect().bottom : null;
            return { text: bottom(leaves.at(-1)), code: bottom(code.at(-1)) };
          });
          expect(last.text).not.toBeNull();
          expect(last.text!, 'the last line of the page ends above the bar').toBeLessThanOrEqual(
            b.top + EDGE,
          );
          if (last.code !== null) {
            expect(last.code, 'the last code box ends above the bar').toBeLessThanOrEqual(
              b.top + EDGE,
            );
          }
          // No sideways scroll came with it.
          const sideways = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(sideways).toBeLessThanOrEqual(0);
        });
      }

      test(`${text} text: KEEP RUNNING and DISCARD are not covered by the bar when focused`, async ({
        page,
      }) => {
        await reach(page, 'confirm open', text);

        await expect(keep(page)).toBeFocused();
        await expect(keep(page)).toBeInViewport();
        const k = await onTop(keep(page));
        expect(k.ok, `KEEP RUNNING is under ${k.found}`).toBe(true);

        await page.keyboard.press('Shift+Tab');
        await expect(yes(page)).toBeFocused();
        await settle(page);
        await expect(yes(page)).toBeInViewport();
        const d = await onTop(yes(page));
        expect(d.ok, `DISCARD is under ${d.found}`).toBe(true);

        // The document's scroll padding is what keeps them clear: it is at
        // least the bar's own height, and it was measured, not written down.
        const pad = await page.evaluate(() => ({
          padding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom),
          bar: document
            .querySelector('section[aria-labelledby="connect-state"]')!
            .getBoundingClientRect().height,
        }));
        expect(pad.padding).toBeGreaterThanOrEqual(pad.bar - EDGE);
        expect(pad.padding).toBeLessThanOrEqual(pad.bar + 24);
      });

      test(`${text} text: no control the keyboard reaches in the run is drawn under the bar`, async ({
        page,
      }) => {
        await reach(page, 'connected', text);
        await page.getByRole('group', { name: 'MCP client' }).getByRole('button').first().click();
        // From the first control of the run column, forward through all of it.
        await page.locator('.panel-in :is(a, button, [tabindex])').first().focus();
        // WebKit brings the focused control into view a frame later.
        await settle(page);

        const covered: string[] = [];
        for (let i = 0; i < 40; i++) {
          const report = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            const main = document.querySelector('main');
            if (!el || !main || !main.contains(el)) return null;
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            const ok = hit !== null && (hit === el || el.contains(hit) || hit.contains(el));
            const name = (el.getAttribute('aria-label') ?? el.textContent ?? '')
              .trim()
              .slice(0, 30);
            return ok ? null : `${name} (centre y=${Math.round(r.top + r.height / 2)})`;
          });
          if (report) covered.push(report);
          await page.keyboard.press('Tab');
          // WebKit brings the focused control into view a frame later.
          await settle(page);
        }
        expect(covered, 'focused controls drawn under something else').toEqual([]);
      });
    }

    test('the bar is last in the document, after the run column, and END RUN is still in it', async ({
      page,
    }) => {
      await reach(page, 'connected', 'normal');
      const tree = await page.evaluate(() => {
        const dock = document.querySelector('section[aria-labelledby="connect-state"]')!;
        const column = document.querySelector('.panel-in')!;
        const slot = document.querySelector('[data-testid="run-bar-slot"]');
        return {
          inSlot: slot !== null && slot.contains(dock),
          afterColumn:
            (column.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          inColumn: column.contains(dock),
          slotPosition: slot ? getComputedStyle(slot).position : 'none',
          barPosition: getComputedStyle(dock).position,
        };
      });
      expect(tree).toEqual({
        inSlot: true,
        afterColumn: true,
        inColumn: false,
        slotPosition: 'sticky',
        barPosition: 'static',
      });
      await expect(bar(page).getByRole('button', { name: /end run/i })).toHaveAccessibleName(
        'End run and get result',
      );
      const target = (await bar(page)
        .getByRole('button', { name: /end run/i })
        .boundingBox())!;
      expect(target.height).toBeGreaterThanOrEqual(44);
    });
  });
}

// ── Sample mode has no bar, and nothing is held at the bottom ──

test.describe('390x844, sample mode', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('draws no bar and an empty slot that takes no room', async ({ page }) => {
    await suppressBootSplash(page);
    await page.goto(FIXTURE);
    await expect(page.getByRole('link', { name: /play sample run/i })).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
    const slot = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="run-bar-slot"]');
      return el ? el.getBoundingClientRect().height : -1;
    });
    expect(slot).toBe(0);
  });
});

// ── Everywhere else the bar is where it was ──

test.describe('1280x900, desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  /** The bar's classes on main (274dece). Nothing in this list may move. */
  const MAIN_BAR =
    'sticky top-[calc(var(--header-clear)+8px)] z-40 -mt-3 [@media(max-height:499px)]:static flex flex-col gap-3 rounded-lg border border-line-em bg-solid px-5 py-3';
  const sorted = (classes: string) => classes.split(/\s+/).filter(Boolean).sort();

  for (const state of ['waiting', 'connected'] as const) {
    test(`${state}: the bar is main's bar, in the column, pinned under the header`, async ({
      page,
    }) => {
      await reach(page, state, 'normal');
      const tree = await page.evaluate(() => {
        const dock = document.querySelector('section[aria-labelledby="connect-state"]')!;
        const column = document.querySelector('.panel-in')!;
        const slot = document.querySelector('[data-testid="run-bar-slot"]')!;
        return {
          classes: dock.className,
          parentIsColumn: dock.parentElement === column,
          afterHeading: dock.previousElementSibling?.id === 'connect-state',
          position: getComputedStyle(dock).position,
          slotChildren: slot.childElementCount,
          slotDisplay: getComputedStyle(slot).display,
          scrollPaddingBottom: getComputedStyle(document.documentElement).scrollPaddingBottom,
        };
      });
      expect(sorted(tree.classes)).toEqual(sorted(MAIN_BAR));
      expect(tree.parentIsColumn).toBe(true);
      expect(tree.afterHeading).toBe(true);
      expect(tree.position).toBe('sticky');
      expect(tree.slotChildren).toBe(0);
      expect(tree.slotDisplay).toBe('none');
      expect(['0px', 'auto']).toContain(tree.scrollPaddingBottom);

      // Scrolled past, it is held just under the header, as it always was.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await settle(page);
      const g = await page.evaluate(() => ({
        header: document.querySelector('header')!.getBoundingClientRect().bottom,
        bar: document
          .querySelector('section[aria-labelledby="connect-state"]')!
          .getBoundingClientRect().top,
      }));
      expect(g.bar).toBeGreaterThanOrEqual(g.header - EDGE);
      expect(g.bar - g.header).toBeLessThan(24);
    });
  }
});

test.describe('844x390, a phone held sideways', () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test('the bar is still in the column and scrolls with the page (#217)', async ({ page }) => {
    await reach(page, 'connected', 'normal');
    const tree = await page.evaluate(() => {
      const dock = document.querySelector('section[aria-labelledby="connect-state"]')!;
      return {
        parentIsColumn: dock.parentElement === document.querySelector('.panel-in'),
        position: getComputedStyle(dock).position,
      };
    });
    expect(tree.parentIsColumn).toBe(true);
    expect(['static', 'relative']).toContain(tree.position);
  });
});

// ── Scrolling boxes: capped, and they hand the scroll on to the page ──

/**
 * A REAL SCROLL, AS NEAR AS EACH ENGINE ALLOWS.
 *
 * Chromium: a finger, through the DevTools protocol (touchStart, a run of
 * touchMoves, touchEnd), which drives the browser's own touch scrolling.
 * WebKit: Playwright cannot synthesise a touch scroll there, and a mobile
 * WebKit context refuses the wheel too, so this opens the same iPhone context
 * without the mobile flag and uses the wheel. That follows the same
 * scroll-chaining rules; it is not a finger, and the spec says so here rather
 * than claim more.
 */
async function phoneForScrolling(
  browser: Browser,
  browserName: string,
  baseURL: string | undefined,
  viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page; scrollFrom: Scroll }> {
  const context = await browser.newContext(
    browserName === 'webkit'
      ? { ...devices['iPhone 13'], isMobile: false, viewport, baseURL }
      : { ...devices['Pixel 7'], viewport, baseURL },
  );
  const page = await context.newPage();
  await suppressBootSplash(page);
  await context.route(/\.woff2?(\?|$)/, (route) => route.abort());
  const cdp = browserName === 'chromium' ? await context.newCDPSession(page) : null;
  const scrollFrom: Scroll = async (x, y, distance) => {
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: y - (distance * i) / 10 }],
        });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, distance);
    }
  };
  return { context, page, scrollFrom };
}
type Scroll = (x: number, y: number, distance: number) => Promise<void>;

/** Scroll from a point and wait for the page to have moved, or not. */
async function pageMovedBy(page: Page, scroll: () => Promise<void>): Promise<number> {
  const before = await page.evaluate(() => window.scrollY);
  await scroll();
  await page
    .waitForFunction((y) => Math.abs(window.scrollY - y) > 20, before, { timeout: 2000 })
    .catch(() => undefined);
  return (await page.evaluate(() => window.scrollY)) - before;
}

for (const viewport of PHONES) {
  test.describe(`${viewport.width}x${viewport.height}, scrolling boxes`, () => {
    test('Connect: no code box is taller than half the screen, and none holds the scroll', async ({
      browser,
      browserName,
      baseURL,
    }) => {
      const { context, page, scrollFrom } = await phoneForScrolling(
        browser,
        browserName,
        baseURL,
        viewport,
      );
      try {
        await page.goto(`${FIXTURE}?state=connected`);
        await page.getByRole('button', { name: /^LIVE/ }).click();
        await page.getByRole('button', { name: /start a run/i }).click();
        await expect(bar(page)).toBeVisible();

        const clients = page.getByRole('group', { name: 'MCP client' }).getByRole('button');
        const count = await clients.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
          await clients.nth(i).click();
          const boxes = await page.evaluate(() =>
            [...document.querySelectorAll('pre')].map((el) => {
              const cs = getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return {
                name: el.getAttribute('aria-label'),
                role: el.getAttribute('role'),
                tabIndex: el.tabIndex,
                heightOfScreen: r.height / window.innerHeight,
                gutterLeft: r.left,
                gutterRight: document.documentElement.clientWidth - r.right,
                overscroll: cs.overscrollBehaviorY ?? 'auto',
              };
            }),
          );
          expect(boxes.length).toBeGreaterThan(0);
          for (const box of boxes) {
            expect(box.heightOfScreen, `${box.name}: height`).toBeLessThanOrEqual(0.5);
            // Page on both sides of it to start a scroll from.
            expect(box.gutterLeft, `${box.name}: left gutter`).toBeGreaterThanOrEqual(16);
            expect(box.gutterRight, `${box.name}: right gutter`).toBeGreaterThanOrEqual(16);
            expect(box.overscroll, `${box.name}: overscroll-behavior`).toBe('auto');
            // Still a named, focusable group for the keyboard and a screen reader.
            expect(box.role).toBe('group');
            expect(box.tabIndex).toBe(0);
            expect(box.name).toBeTruthy();
          }
        }

        // A scroll that starts on the tallest code box moves the page.
        await clients.first().click();
        const tallest = page.locator('pre').first();
        const config = page.getByRole('group', { name: /config/i }).first();
        const target = (await config.count()) > 0 ? config : tallest;
        await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        const b = (await target.boundingBox())!;
        const onBox = await pageMovedBy(page, () =>
          scrollFrom(b.x + b.width / 2, b.y + b.height / 2, 200),
        );
        expect(onBox, 'page scroll from a start on the code box').toBeGreaterThan(20);
        // And so does one that starts in the page gutter beside it.
        const inGutter = await pageMovedBy(page, () => scrollFrom(6, viewport.height / 2, 200));
        expect(inGutter, 'page scroll from a start in the gutter').toBeGreaterThan(20);
      } finally {
        await context.close();
      }
    });

    test('Replay: the terminal is at most half the screen, and at its end the page scrolls', async ({
      browser,
      browserName,
      baseURL,
    }) => {
      const { context, page, scrollFrom } = await phoneForScrolling(
        browser,
        browserName,
        baseURL,
        viewport,
      );
      try {
        await page.goto('/runs/sample', { waitUntil: 'domcontentloaded' });
        const list = page.getByRole('list', { name: 'Attack replay step timeline' });
        await expect(list).toBeVisible();
        const terminal = list.locator('xpath=..');

        const box = await terminal.evaluate((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return {
            heightOfScreen: r.height / window.innerHeight,
            gutterLeft: r.left,
            gutterRight: document.documentElement.clientWidth - r.right,
            overscroll: cs.overscrollBehaviorY ?? 'auto',
            overflowY: cs.overflowY,
          };
        });
        test.info().annotations.push({
          type: 'terminal',
          description: `${Math.round(box.heightOfScreen * 1000) / 10}% of the screen`,
        });
        expect(box.heightOfScreen).toBeLessThanOrEqual(0.5);
        expect(box.gutterLeft).toBeGreaterThanOrEqual(16);
        expect(box.gutterRight).toBeGreaterThanOrEqual(16);
        expect(box.overscroll).toBe('auto');
        expect(box.overflowY).toBe('auto');

        // Put the terminal mid-screen and at the end of its own scroll. The
        // replay follows its first step into view as it opens, so the end is
        // asked for until it holds.
        const room = await terminal.evaluate((el) => el.scrollHeight - el.clientHeight);
        expect(room, 'the terminal has a scroll of its own to be at the end of').toBeGreaterThan(0);
        await terminal.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await expect(async () => {
          await terminal.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
          // Long enough for a scroll the replay had under way to have won.
          await page.waitForTimeout(500);
          expect(
            await terminal.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
            'the terminal rests at its end',
          ).toBeLessThanOrEqual(1);
        }).toPass({ timeout: 15_000 });
        const b = (await terminal.boundingBox())!;
        const atEnd = await pageMovedBy(page, () =>
          scrollFrom(b.x + b.width / 2, b.y + b.height / 2, 200),
        );
        expect(atEnd, 'page scroll from a start on the terminal at its end').toBeGreaterThan(20);

        const b2 = (await terminal.boundingBox())!;
        const inGutter = await pageMovedBy(page, () =>
          scrollFrom(6, Math.max(100, Math.min(viewport.height - 100, b2.y + b2.height / 2)), 200),
        );
        expect(inGutter, 'page scroll from a start in the gutter').toBeGreaterThan(20);
      } finally {
        await context.close();
      }
    });
  });
}
