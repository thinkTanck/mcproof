import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * HOME: THREE QUIET ELEMENTS MADE READABLE, MEASURED IN A REAL BROWSER.
 *
 * The hero trace's travelling sweep, the logo ring's rotating arc and the header
 * pulse were all on the page and all close to invisible. The sweep was the worst:
 * its glow named `--cyan-400`, a token that does not exist, so the declaration
 * was invalid and it painted nothing at all.
 *
 * They are louder now, and only a little. The breach reticle is still the one
 * loud thing in the hero: it stays larger than every other node and it is the
 * only node that is red. And nothing here may cost layout: the hero keeps the
 * heights it had (measured on main before the change), the header stays 72px,
 * and nothing scrolls sideways.
 *
 * jsdom has no layout, no computed `var()` and no animation, so this runs in
 * Chromium.
 */

// Measured on main (9d81568) before any of this changed. The rail's rows and
// the list that holds them are what a larger node could push; the panel around
// them is not pinned here, because its heading wraps or not with the font the
// visit happened to get (Geist is `display: 'optional'`), which is not this.
const BASELINE = {
  rowHeight: 25.5,
  breachRowHeight: 36,
  listHeight: 214.5,
} as const;

async function home(page: Page) {
  await suppressBootSplash(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

const measure = (page: Page) =>
  page.evaluate(() => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="hero-step"]')];
    const plain = rows.filter((r) => r.dataset.breach !== 'true');
    const breach = rows.find((r) => r.dataset.breach === 'true')!;
    const sweeps = plain.map((r) => r.querySelector<HTMLElement>('.hero-sweep')!);
    const dot = sweeps[0]!.parentElement!;
    const marker = breach.querySelector('[data-testid="hero-breach-marker"]')!;
    const list = rows[0]!.parentElement!;
    const header = document.querySelector('header')!;
    const svg = header.querySelector('a[aria-label="MCPwn home"] svg')!;
    const arc = svg.querySelectorAll('circle')[1]!;
    const pulse = header.querySelector<HTMLElement>('[data-header-pulse]')!;
    const glint = pulse.firstElementChild as HTMLElement;
    const sweepStyle = getComputedStyle(sweeps[0]!);
    return {
      rowHeights: [...new Set(plain.map((r) => r2(r.getBoundingClientRect().height)))],
      breachRowHeight: r2(breach.getBoundingClientRect().height),
      listHeight: r2(list.getBoundingClientRect().height),
      dot: r2(dot.getBoundingClientRect().width),
      reticle: r2(marker.getBoundingClientRect().width),
      sweepBackground: sweepStyle.backgroundImage,
      // The sweep's own box, before the animation scales it.
      sweepBox: sweeps[0]!.offsetWidth,
      sweepAnimation: sweepStyle.animationName,
      headerHeight: Math.round(header.getBoundingClientRect().height),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      // Layout size, not the rotated bounding box.
      ring: (svg as unknown as HTMLElement).clientWidth || parseFloat(getComputedStyle(svg).width),
      arcWidth: parseFloat(getComputedStyle(arc).strokeWidth),
      arcLength: parseFloat(getComputedStyle(arc).strokeDasharray),
      spinSeconds: parseFloat(getComputedStyle(svg).animationDuration),
      glintHeight: r2(glint.getBoundingClientRect().height),
      glintFilter: getComputedStyle(glint).filter,
      pulseAnimation: getComputedStyle(glint).animationName,
      pulseSeconds: parseFloat(getComputedStyle(glint).animationDuration),
    };
  });

for (const [width, height] of [
  [1280, 900],
  [390, 844],
  [320, 568],
] as const) {
  test.describe(`home visual weight at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('the hero sweep paints: its glow resolves to a real colour', async ({ page }) => {
      await home(page);
      const m = await measure(page);

      // An undefined token left this at `none`.
      expect(m.sweepBackground).toContain('radial-gradient');
      expect(m.sweepAnimation).toBe('hero-sweep');
    });

    test('the step dots are larger, and the breach reticle is still the largest', async ({
      page,
    }) => {
      await home(page);
      const m = await measure(page);

      expect(m.dot).toBe(13);
      expect(m.reticle).toBe(18);
      expect(m.reticle).toBeGreaterThan(m.dot);
      // The glow is wider than the dot it surrounds, and wider than it was (20px).
      expect(m.sweepBox).toBeGreaterThan(20);
    });

    test('the hero keeps every height it had: nothing moved to make room', async ({ page }) => {
      await home(page);
      const m = await measure(page);

      expect(m.rowHeights).toEqual([BASELINE.rowHeight]);
      expect(m.breachRowHeight).toBe(BASELINE.breachRowHeight);
      expect(m.listHeight).toBe(BASELINE.listHeight);
    });

    test('the logo ring is larger where there is room, with a visible arc, turning faster', async ({
      page,
    }) => {
      await home(page);
      const m = await measure(page);

      // 34px from 360 up. Below that the header has 5px to spare on a run screen
      // (#178), so the ring keeps its 30px there.
      expect(m.ring).toBe(width >= 360 ? 34 : 30);
      expect(m.arcWidth).toBeGreaterThanOrEqual(2);
      expect(m.arcLength).toBeGreaterThanOrEqual(12);
      expect(m.spinSeconds).toBe(13);
      expect(m.headerHeight).toBe(72);
      expect(m.pageOverflow).toBe(0);
    });

    test('the header pulse is a 2.5px line with a soft glow, on a 12 second cycle', async ({
      page,
    }) => {
      await home(page);
      const m = await measure(page);

      expect(m.glintHeight).toBe(2.5);
      expect(m.glintFilter).toContain('drop-shadow');
      expect(m.pulseAnimation).toBe('header-pulse');
      expect(m.pulseSeconds).toBeCloseTo(12, 5);
      expect(m.headerHeight).toBe(72);
    });

    test('reduced motion stops all three', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await home(page);
      const m = await measure(page);

      expect(m.sweepAnimation).toBe('none');
      expect(m.pulseAnimation).toBe('none');
      // The ring's spin is collapsed to a single near-instant pass by the global rule.
      expect(m.spinSeconds).toBeLessThan(0.01);
      // And the layout is the same with motion off.
      expect(m.rowHeights).toEqual([BASELINE.rowHeight]);
      expect(m.headerHeight).toBe(72);
    });
  });
}
