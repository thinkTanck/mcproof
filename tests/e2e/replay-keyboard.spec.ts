import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * TAB NEVER LANDS ON SOMETHING YOU CANNOT SEE (sweep 2026-10-07, R1; WCAG 2.4.7).
 *
 * The replay terminal keeps the steps the playhead has not reached in the
 * accessibility tree, visually hidden. They were also tab stops: from the first
 * step of the sample run, seven presses of Tab put focus on a one-pixel element
 * with nothing on screen to show where it was, before the transport came up.
 *
 * Focus geometry and the focus ring depend on real layout and real CSS, which
 * jsdom has neither of, so this walks a real browser.
 */

type Stop = {
  name: string;
  width: number;
  height: number;
  outline: string;
  inStepList: boolean;
};

/** Press Tab and describe what took focus. */
async function tab(page: Page): Promise<Stop> {
  await page.keyboard.press('Tab');
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      name: (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      outline:
        style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
          ? `${style.outlineWidth} ${style.outlineStyle}`
          : 'none',
      inStepList: el.closest('ol[aria-label="Attack replay step timeline"]') !== null,
    };
  });
}

/** Tab from the top of the page until the transport's first control has focus. */
async function walkToTransport(page: Page): Promise<Stop[]> {
  const stops: Stop[] = [];
  for (let i = 0; i < 40; i += 1) {
    const stop = await tab(page);
    stops.push(stop);
    if (stop.name === 'Restart') return stops;
  }
  throw new Error(`never reached the transport: ${stops.map((s) => s.name).join(' > ')}`);
}

function expectAllVisibleWithARing(stops: Stop[]) {
  for (const stop of stops) {
    // Bigger than the one-pixel box a visually hidden element is clipped to.
    expect(stop.width, `"${stop.name}" has a visible width`).toBeGreaterThan(8);
    expect(stop.height, `"${stop.name}" has a visible height`).toBeGreaterThan(8);
    expect(stop.outline, `"${stop.name}" shows a focus ring`).not.toBe('none');
  }
}

for (const [width, height] of [
  [1280, 900],
  [320, 568],
] as const) {
  test.describe(`replay keyboard order at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test.beforeEach(async ({ page }) => {
      await suppressBootSplash(page);
      await page.goto('/runs/sample');
      await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    });

    test('at the start: every stop on the way to the transport is visible, with a focus ring', async ({
      page,
    }) => {
      const stops = await walkToTransport(page);

      expectAllVisibleWithARing(stops);
      // One step is drawn at the start, so one step is a stop. Then the verdict
      // terminal's own controls, then the transport: no invisible stop between.
      const steps = stops.filter((stop) => stop.inStepList);
      expect(steps.map((stop) => stop.name)).toEqual(['Step 1: Principal instruction']);
    });

    test('a screen reader still finds all eight steps in the list', async ({ page }) => {
      const steps = page
        .getByRole('list', { name: 'Attack replay step timeline' })
        .getByRole('button');

      await expect(steps).toHaveCount(8);
      await expect(steps.nth(5)).toHaveAccessibleName('Step 6: Tool call, compromise step');
    });

    test('at the end: all eight steps are stops, each visible with a focus ring', async ({
      page,
    }) => {
      await page.getByRole('slider', { name: 'Scrub to step' }).focus();
      await page.keyboard.press('End');
      await expect(page.getByText('STEP 08')).toBeVisible();
      // Back to the first stop in the document (the skip link), so the walk covers
      // the same ground a visitor's does. Blurring is not enough: the browser
      // keeps tabbing from where focus last was.
      await page.getByRole('link', { name: 'Skip to content' }).focus();

      const stops = await walkToTransport(page);

      expectAllVisibleWithARing(stops);
      expect(stops.filter((stop) => stop.inStepList)).toHaveLength(8);
    });
  });
}
