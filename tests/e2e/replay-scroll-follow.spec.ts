import { test, expect, type Page } from '@playwright/test';
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

/** Note the page's and the terminal's scroll on every frame from now on. */
async function record(page: Page) {
  await page.evaluate((selector) => {
    const w = window as unknown as { __rec: { y: number; box: number }[] };
    const box = document.querySelector(selector)!;
    w.__rec = [];
    const tick = () => {
      w.__rec.push({ y: window.scrollY, box: box.scrollTop });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, BOX);
}

const recorded = (page: Page) =>
  page.evaluate(() => (window as unknown as { __rec: { y: number; box: number }[] }).__rec);

const fastest = (page: Page) =>
  page.getByRole('group', { name: 'Playback speed' }).getByRole('button').last();

const readout = (page: Page) => page.getByText(/^STEP \d\d/).filter({ visible: true });
const stepNow = async (page: Page) =>
  Number(/STEP (\d+)/.exec((await readout(page).first().textContent()) ?? '')![1]);

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
        expect(rec.at(-1)!.box, 'the terminal scrolled itself').toBeGreaterThan(rec[0]!.box);
      });
    }

    test('scrolling up inside the terminal stops the follow; back at the bottom it resumes', async ({
      page,
    }) => {
      await open(page, 'asi06-run', viewport);
      const y0 = await scrollToControls(page);
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      const box = page.locator(BOX);
      // Wait for the follow to have scrolled the terminal at least once.
      await expect
        .poll(() => box.evaluate((el) => el.scrollTop), { timeout: 30_000 })
        .toBeGreaterThan(0);

      await box.hover();
      const followedTo = await box.evaluate((el) => el.scrollTop);
      await page.mouse.wheel(0, -120);
      // A wheel scroll is animated: read where it came to rest, over a few frames.
      const settled = () =>
        box.evaluate(
          (el) =>
            new Promise<number>((resolve) => {
              let last = el.scrollTop;
              let still = 0;
              const tick = () => {
                still = el.scrollTop === last ? still + 1 : 0;
                last = el.scrollTop;
                if (still >= 10) resolve(last);
                else requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            }),
        );
      const held = await settled();
      expect(held, 'the viewer scrolled up inside the terminal').toBeLessThan(followedTo);
      const before = await stepNow(page);
      // Another step plays while the viewer reads back.
      await expect
        .poll(() => stepNow(page), { timeout: 30_000 })
        .toBeGreaterThanOrEqual(before + 1);
      expect(Math.abs((await box.evaluate((el) => el.scrollTop)) - held)).toBeLessThanOrEqual(1);

      // Back down to the bottom: the next step is followed again.
      await page.mouse.wheel(0, 5000);
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
        await expect.poll(inView, { message: 'the current step is in view again' }).toBe(true);
      }
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
          new Promise<number>((resolve) => {
            let frames = 0;
            const tick = () =>
              ++frames >= 10 ? resolve(window.scrollY) : requestAnimationFrame(tick);
            requestAnimationFrame(tick);
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
      expect(rec.at(-1)!.box).toBeGreaterThan(rec[0]!.box);
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
