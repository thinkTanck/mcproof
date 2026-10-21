import { test, expect, type Locator, type Page } from '@playwright/test';
import { expectNoWcagViolations, suppressBootSplash } from './support/screen';

/**
 * PLAYING A REPLAY NEVER MOVES THE PAGE (owner ruling REPLAY SCROLL,
 * 2026-10-20).
 *
 * The bug: on desktop the terminal called `scrollIntoView({ block: 'center' })`
 * on every step, which scrolls the page as well as the terminal, so a viewer
 * who had scrolled down to the step card and the controls was pulled back up
 * on each step. Now the terminal scrolls only itself, at every width, and only
 * while the viewer is at its bottom: scroll up inside it and it stays where
 * you left it until you come back down.
 *
 * Read as what happened, never as a time: a recorder notes the page's and the
 * terminal's scroll positions on every frame, and the test waits for the
 * replay to reach its end (the verdict revealed) or for the step readout to
 * move on.
 */

const SAMPLE_RUNS = [
  'sample',
  'asi01-goal-hijack',
  'asi03-identity-privilege-abuse',
  'asi04-run',
  'asi05-code-execution',
  'asi06-run',
  'asi10-goal-drift',
] as const;

const DESKTOP = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const;

const BOX = 'div:has(> ol[aria-label="Attack replay step timeline"])';

async function open(page: Page, run: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await suppressBootSplash(page);
  await page.goto(`/runs/${run}`);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
}

/** Scroll the page so the step card and the controls are on screen, low down. */
async function scrollToControls(page: Page) {
  const y = await page.evaluate(() => {
    const detail = document.querySelector('section[aria-label="Step detail"]')!;
    const play = document.querySelector('button[aria-label="Play"]')!;
    const bottom = Math.max(
      detail.getBoundingClientRect().bottom,
      play.getBoundingClientRect().bottom,
    );
    window.scrollTo(0, Math.max(0, window.scrollY + bottom - window.innerHeight + 16));
    return window.scrollY;
  });
  await expect(page.locator('section[aria-label="Step detail"]')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeInViewport();
  return y;
}

/**
 * Note the page's and the terminal's scroll from now on: on every scroll of
 * either, and on a short interval besides. Not per frame: headless WebKit
 * delivers only a few frames a second, which would leave gaps a move could
 * hide in.
 */
async function record(page: Page) {
  await page.evaluate((selector) => {
    const w = window as unknown as { __rec: { y: number; box: number }[] };
    const box = document.querySelector(selector)!;
    w.__rec = [];
    const note = () => w.__rec.push({ y: window.scrollY, box: box.scrollTop });
    window.addEventListener('scroll', note, { passive: true });
    box.addEventListener('scroll', note, { passive: true });
    setInterval(note, 16);
    note();
  }, BOX);
}

const recorded = (page: Page) =>
  page.evaluate(() => (window as unknown as { __rec: { y: number; box: number }[] }).__rec);

const fastest = (page: Page) =>
  page.getByRole('group', { name: 'Playback speed' }).getByRole('button').last();

const readout = (page: Page) => page.getByText(/^STEP \d\d/).filter({ visible: true });
const stepNow = async (page: Page) =>
  Number(/STEP (\d+)/.exec((await readout(page).first().textContent()) ?? '')![1]);

/**
 * Where the box comes to rest: its scrollTop once it has not moved for 800 ms,
 * read on an interval (not per frame, which headless WebKit delivers only a
 * few of a second). Long enough for desktop WebKit, which applies a scroll up
 * to about 400 ms late and sometimes in parts (DESKTOP WEBKIT diagnostic,
 * 2026-10-21).
 */
const settledTop = (box: Locator) =>
  box.evaluate(
    (el) =>
      new Promise<number>((resolve) => {
        let last = el.scrollTop;
        let still = 0;
        const timer = setInterval(() => {
          still = el.scrollTop === last ? still + 1 : 0;
          last = el.scrollTop;
          if (still >= 20) {
            clearInterval(timer);
            resolve(last);
          }
        }, 40);
      }),
  );

/**
 * Does this project scroll the terminal with keys rather than a wheel? Desktop
 * WebKit does: there Playwright's synthetic wheel reaches the page about 400 ms
 * late and its scroll lands in parts up to 400 ms after that, so a wheel
 * cannot land inside a follow on cue. PageUp and End in the focused terminal
 * reach it within about 10 ms. The wheel stays where it is dispatched at once
 * (Chromium).
 */
const usesKeys = () => test.info().project.name === 'webkit-desktop';

/** Scroll up inside the terminal, the way the viewer would. */
async function scrollUpInside(page: Page, box: Locator) {
  if (usesKeys()) {
    await box.locator('button[aria-current="step"]').focus();
    await page.keyboard.press('PageUp');
  } else {
    await box.hover();
    await page.mouse.wheel(0, -120);
  }
}

/** Scroll back down to the bottom of the terminal, the way the viewer would (the focus is still in it). */
async function scrollToBottomInside(page: Page) {
  if (usesKeys()) await page.keyboard.press('End');
  else await page.mouse.wheel(0, 5000);
}

for (const viewport of DESKTOP) {
  test.describe(`replay scroll at ${viewport.width}x${viewport.height}`, () => {
    for (const run of SAMPLE_RUNS) {
      test(`/runs/${run}: playing keeps the page still while the terminal follows inside itself`, async ({
        page,
      }) => {
        await open(page, run, viewport);
        await fastest(page).click();
        const y0 = await scrollToControls(page);
        expect(y0, 'the page has scrolled to the controls').toBeGreaterThan(0);
        await record(page);
        await page.getByRole('button', { name: 'Play', exact: true }).click();
        // The end of the replay: the verdict is revealed.
        await expect(page.locator('[data-verdict-pending]')).toHaveCount(0, { timeout: 60_000 });
        const rec = await recorded(page);
        expect(rec.length).toBeGreaterThan(10);
        const drift = Math.max(...rec.map((r) => Math.abs(r.y - y0)));
        expect(drift, 'the page never moved').toBeLessThanOrEqual(1);
        // Where the transcript's rows are taller than its box, the box scrolled
        // itself to follow them by more than a few pixels. Measured on the step
        // list, not the box: the box keeps room under the last line, so its own
        // scroll height says nothing, and in some engines' fonts a short run's
        // rows fit (desktop WebKit, asi05 at 1440).
        const overflows = await page.locator(BOX).evaluate((el) => {
          const list = el.querySelector('ol')!.getBoundingClientRect().height;
          const pad =
            parseFloat(getComputedStyle(el).paddingTop) +
            parseFloat(getComputedStyle(el).paddingBottom);
          return list + pad > el.clientHeight + 24;
        });
        if (overflows) {
          // Read once it has come to rest: desktop WebKit applies the last
          // follow late, after the verdict is already revealed.
          expect(
            await settledTop(page.locator(BOX)),
            'the terminal scrolled itself',
          ).toBeGreaterThan(rec[0]!.box);
        }
      });
    }

    test('scrolling up inside the terminal stops the follow; back at the bottom it resumes', async ({
      page,
    }) => {
      await open(page, 'asi06-run', viewport);
      // The slowest speed, so steps are left to play after the scroll up and
      // after the return to the bottom.
      await page.getByRole('group', { name: 'Playback speed' }).getByRole('button').first().click();
      const y0 = await scrollToControls(page);
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      const box = page.locator(BOX);
      // Wait for the follow to have scrolled the terminal at least once, and
      // for that follow to have come to rest.
      await expect
        .poll(() => box.evaluate((el) => el.scrollTop), { timeout: 30_000 })
        .toBeGreaterThan(0);
      const followedTo = await settledTop(box);

      await scrollUpInside(page, box);
      // The engine may apply the scroll late (desktop WebKit, about 400 ms):
      // wait for it to have moved up, then for it to come to rest.
      await expect
        .poll(() => box.evaluate((el) => el.scrollTop), { timeout: 10_000 })
        .toBeLessThan(followedTo);
      const held = await settledTop(box);
      const before = await stepNow(page);
      // Another step plays while the viewer reads back.
      await expect
        .poll(() => stepNow(page), { timeout: 30_000 })
        .toBeGreaterThanOrEqual(before + 1);
      expect(
        Math.abs((await settledTop(box)) - held),
        'the follow stayed stopped',
      ).toBeLessThanOrEqual(1);

      // Back down to the bottom: the next step is followed again.
      await scrollToBottomInside(page);
      await settledTop(box);
      const resumedAt = await stepNow(page);
      const total = await page.locator('ol[aria-label="Attack replay step timeline"] > li').count();
      if (resumedAt < total) {
        await expect.poll(() => stepNow(page), { timeout: 30_000 }).toBeGreaterThan(resumedAt);
        // The follow scrolls smoothly, so it is read once it has arrived.
        const inView = () =>
          box.evaluate((el) => {
            const current = el.querySelector('button[aria-current="step"]');
            if (!current) return false;
            const b = el.getBoundingClientRect();
            const r = current.getBoundingClientRect();
            return r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
          });
        await expect
          .poll(inView, { message: 'the current step is in view again', timeout: 10_000 })
          .toBe(true);
      }
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - y0)).toBeLessThanOrEqual(1);
    });

    test('scrolling up in the middle of a smooth follow stops it there, and the page never moves', async ({
      page,
    }) => {
      // The #250 failure: a scroll up that lands while the follow is still on
      // its way down was not seen, and the follow carried the box back down.
      // The steps are taken here one at a time, so the scroll up lands in a
      // follow every time and steps are left to play after it. In Chromium
      // the scroll up is a real wheel, with Next pressed by the keyboard and
      // the pointer resting on the terminal; in desktop WebKit, where
      // Playwright's synthetic wheel reaches the page about 400 ms late (after
      // the follow it was meant to interrupt has ended), it is PageUp in the
      // focused terminal, with Next pressed by a click event that leaves the
      // focus where it is.
      await open(page, 'asi06-run', viewport);
      const y0 = await scrollToControls(page);
      const box = page.locator(BOX);
      const next = page.getByRole('button', { name: 'Next step' }).filter({ visible: true });
      const keys = usesKeys();
      if (keys) {
        await next.dispatchEvent('click');
        await settledTop(box);
        await box.locator('button[aria-current="step"]').focus();
      } else {
        await box.hover();
        await next.focus();
      }
      const step = () => (keys ? next.dispatchEvent('click') : page.keyboard.press('Enter'));

      // Step until the box has followed well down it, so a scroll up cannot
      // reach past its top and chain to the page (the viewer's own scroll).
      for (let i = 0; i < 20 && (await box.evaluate((el) => el.scrollTop)) < 150; i += 1) {
        await step();
        await settledTop(box);
      }
      expect(await box.evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(150);
      // One more step starts a smooth follow; scroll up the moment it moves.
      const moving = box.evaluate(
        (el) =>
          new Promise<void>((resolve) => {
            const from = el.scrollTop;
            const timer = setInterval(() => {
              if (el.scrollTop !== from) {
                clearInterval(timer);
                resolve();
              }
            }, 5);
          }),
      );
      await step();
      await moving;
      if (keys) await page.keyboard.press('PageUp');
      else await page.mouse.wheel(0, -120);
      const rest = await settledTop(box);
      // Two more steps, and the box stays where the scroll up left it.
      await step();
      await step();
      expect(
        Math.abs((await settledTop(box)) - rest),
        'the follow stayed stopped',
      ).toBeLessThanOrEqual(1);
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - y0)).toBeLessThanOrEqual(1);
    });

    test('opening a speaker definition during playback leaves the page where it is', async ({
      page,
    }) => {
      await open(page, 'asi06-run', viewport);
      const y0 = await scrollToControls(page);
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect.poll(() => stepNow(page), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
      await expect(page.locator('[data-replay-playing]')).toHaveCount(1);
      // Opened the way a press opens it, without the test runner scrolling to it.
      const handle = page.locator('ol[aria-label="Attack replay step timeline"] details').nth(1);
      await handle.locator('summary').evaluate((el) => (el as HTMLElement).click());
      await expect(handle.locator('[data-speaker-panel]')).toBeVisible();
      const y = await page.evaluate(
        () =>
          // The largest the page moved over the next 300 ms, read on an interval.
          new Promise<number>((resolve) => {
            let far = window.scrollY;
            let reads = 0;
            const timer = setInterval(() => {
              if (Math.abs(window.scrollY - far) > 0) far = window.scrollY;
              if (++reads >= 10) {
                clearInterval(timer);
                resolve(far);
              }
            }, 30);
          }),
      );
      expect(Math.abs(y - y0), 'the page did not move').toBeLessThanOrEqual(1);
    });

    test('with motion reduced, playing keeps the page still too', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, 'sample', viewport);
      await fastest(page).click();
      const y0 = await scrollToControls(page);
      await record(page);
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect(page.locator('[data-verdict-pending]')).toHaveCount(0, { timeout: 60_000 });
      const rec = await recorded(page);
      expect(Math.max(...rec.map((r) => Math.abs(r.y - y0)))).toBeLessThanOrEqual(1);
      expect(await settledTop(page.locator(BOX))).toBeGreaterThan(rec[0]!.box);
    });

    test('has no WCAG violation after playing to the end', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, 'sample', viewport);
      await fastest(page).click();
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await expect(page.locator('[data-verdict-pending]')).toHaveCount(0, { timeout: 60_000 });
      await expectNoWcagViolations(page);
    });
  });
}
