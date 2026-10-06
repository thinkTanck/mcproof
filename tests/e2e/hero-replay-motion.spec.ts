import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE HERO REPLAY'S MOTION, MEASURED IN A REAL BROWSER.
 *
 * Two things move in the hero box besides the breach marker. The sweep: a pulse
 * of light that travels down the trace rail in about a second and repeats every
 * 3.2. And the frame accent: one dim cyan light that goes round the box's border
 * once every 14.4 seconds, the cue that this is a readout and not a picture.
 *
 * Both are ambience and neither may cost anything. The box is exactly the size
 * it is without them, nothing on the page shifts while they run, and under
 * `prefers-reduced-motion` the sweep stops and the accent is not drawn at all.
 * The breach marker stays the loudest thing in the box: the accent is one pixel
 * thick, has no glow, and is dimmer than the marker.
 *
 * Animation timing, computed styles and layout shift are all things jsdom does
 * not have, so this runs in Chromium.
 */

async function home(page: Page) {
  await suppressBootSplash(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

const measure = (page: Page) =>
  page.evaluate(() => {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="hero-step"]')];
    const box = rows[0]!.closest<HTMLElement>('[role="img"]')!;
    const sweeps = rows.map((row) => row.querySelector<HTMLElement>('.hero-sweep'));
    const accent = box.querySelector<HTMLElement>('[data-testid="hero-frame-accent"]');
    const light = accent?.firstElementChild as HTMLElement | null;
    const marker = box.querySelector<HTMLElement>('[data-testid="hero-breach-marker"]')!;
    const rect = box.getBoundingClientRect();
    const as = accent ? getComputedStyle(accent) : null;
    const ls = light ? getComputedStyle(light) : null;
    return {
      box: { width: r2(rect.width), height: r2(rect.height) },
      rowHeights: [...new Set(rows.map((row) => r2(row.getBoundingClientRect().height)))],
      sweepDelays: sweeps.map((s) => (s ? parseFloat(getComputedStyle(s).animationDelay) : null)),
      sweepSeconds: parseFloat(getComputedStyle(sweeps.find((s) => s !== null)!).animationDuration),
      sweepName: getComputedStyle(sweeps.find((s) => s !== null)!).animationName,
      accents: box.querySelectorAll('[data-testid="hero-frame-accent"]').length,
      accentDisplay: as?.display ?? null,
      accentHidden: accent?.getAttribute('aria-hidden') ?? null,
      accentPosition: as?.position ?? null,
      accentPointer: as?.pointerEvents ?? null,
      // The ring it is drawn in: the accent's own padding is its thickness.
      accentThickness: as ? parseFloat(as.paddingTop) : null,
      accentBox: accent
        ? {
            width: r2(accent.getBoundingClientRect().width),
            height: r2(accent.getBoundingClientRect().height),
          }
        : null,
      lightName: ls?.animationName ?? null,
      lightSeconds: ls ? parseFloat(ls.animationDuration) : null,
      lightIteration: ls?.animationIterationCount ?? null,
      lightTiming: ls?.animationTimingFunction ?? null,
      lightGlow: ls ? `${ls.boxShadow} ${ls.filter}` : null,
      lightBackground: ls?.backgroundImage ?? null,
      markerSize: r2(marker.getBoundingClientRect().width),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

for (const [width, height] of [
  [1280, 900],
  [390, 844],
  [320, 568],
] as const) {
  test.describe(`hero replay motion at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('the sweep crosses the rail in about a second and repeats every 3.2', async ({ page }) => {
      await home(page);
      const m = await measure(page);

      expect(m.sweepName).toBe('hero-sweep');
      expect(m.sweepSeconds).toBe(3.2);
      // 0.15s a node, top to bottom. The breach row has no sweep of its own.
      m.sweepDelays.forEach((delay, i) => {
        if (delay !== null) expect(delay).toBeCloseTo(i * 0.15, 5);
      });
      expect(m.sweepDelays.filter((d) => d === null)).toHaveLength(1);
      const travel = Math.max(...m.sweepDelays.filter((d): d is number => d !== null));
      expect(travel).toBeLessThan(1.2);
      expect(travel).toBeLessThan(m.sweepSeconds / 2);
    });

    test('one frame accent goes round the border, slowly, at a constant rate', async ({ page }) => {
      await home(page);
      const m = await measure(page);

      expect(m.accents).toBe(1);
      expect(m.accentHidden).toBe('true');
      expect(m.lightName).toBe('hero-frame-lap');
      expect(m.lightIteration).toBe('infinite');
      expect(m.lightTiming).toBe('linear');
      // One lap on a calm interval: slower than the header pulse's 12s cycle.
      expect(m.lightSeconds).toBeGreaterThanOrEqual(12);
      // A light, not an outline: one sliver of a conic gradient.
      expect(m.lightBackground).toContain('conic-gradient');
    });

    test('the accent is subordinate to the breach marker: one pixel, no glow', async ({ page }) => {
      await home(page);
      const m = await measure(page);

      expect(m.accentThickness).toBe(1);
      expect(m.lightGlow).toBe('none none');
      expect(m.markerSize).toBe(18);
      expect(m.markerSize).toBeGreaterThan(m.accentThickness! * 10);
    });

    test('the accent costs the box nothing: same size with it and without it', async ({ page }) => {
      await home(page);
      const withAccent = await measure(page);
      await page.addStyleTag({
        content: '[data-testid="hero-frame-accent"]{display:none !important}',
      });
      const without = await measure(page);

      expect(withAccent.box).toEqual(without.box);
      expect(withAccent.rowHeights).toEqual(without.rowHeights);
      // Out of the flow, exactly over the box, and it takes no clicks.
      expect(withAccent.accentPosition).toBe('absolute');
      expect(withAccent.accentPointer).toBe('none');
      expect(withAccent.accentBox!.width).toBeLessThanOrEqual(withAccent.box.width);
      expect(withAccent.accentBox!.height).toBeLessThanOrEqual(withAccent.box.height);
      expect(withAccent.pageOverflow).toBe(0);
    });

    test('nothing on the page shifts while the sweep and the accent run', async ({ page }) => {
      await home(page);
      await page.locator('[data-testid="hero-step"]').first().scrollIntoViewIfNeeded();
      const shift = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            let total = 0;
            const observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                const e = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
                if (!e.hadRecentInput) total += e.value;
              }
            });
            observer.observe({ type: 'layout-shift', buffered: false });
            // A whole sweep loop and a good part of a lap.
            setTimeout(() => {
              observer.disconnect();
              resolve(total);
            }, 4000);
          }),
      );

      expect(shift).toBe(0);
    });

    test('reduced motion stops the sweep and does not draw the accent', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await home(page);
      const m = await measure(page);

      expect(m.sweepName).toBe('none');
      expect(m.accentDisplay).toBe('none');
      expect(m.lightName).toBe('none');
      // The box is the same size it is with motion on. Same page, no reload, so
      // the font the visit got cannot change between the two readings.
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const moving = await measure(page);
      expect(moving.box).toEqual(m.box);
      expect(moving.accentDisplay).not.toBe('none');
    });
  });
}
