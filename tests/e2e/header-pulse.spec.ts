import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE AMBIENT HEADER PULSE, MEASURED IN A REAL BROWSER.
 *
 * A slow line of light crosses the blank part of the status bar on every shell
 * screen. It is CSS only, it paints and never lays out, and it stops under
 * `prefers-reduced-motion`. What it must never do is cost the header anything:
 * the bar stays 72px, nothing scrolls sideways, and the chip stays where it was.
 *
 * Geometry, animation and media queries are all things jsdom does not have, so
 * these run in Chromium. The LIVE colour cannot be reached on a real route here
 * (a live run needs a signed-in account and a stored run), so it is measured on
 * the header-states fixture, which renders the real `StatusBar` over a fake mode
 * and is built only with E2E_FIXTURES=1 (see src/config/e2e-fixtures.ts).
 */

const SCREENS: { name: string; path: string; mode: 'sample' | 'neutral' }[] = [
  { name: 'home', path: '/', mode: 'neutral' },
  { name: 'connect', path: '/connect', mode: 'neutral' },
  { name: 'replay', path: '/runs/sample', mode: 'sample' },
  { name: 'findings', path: '/findings/sample', mode: 'sample' },
  { name: 'leaderboard', path: '/leaderboard', mode: 'neutral' },
  { name: 'threats', path: '/threats', mode: 'neutral' },
];

const FIXTURE = '/e2e/header-states';

async function open(page: Page, path: string) {
  await suppressBootSplash(page);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

/** What the header and its pulse measure, in the first header on the page. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const header = document.querySelector('header')!;
    const pulse = header.querySelector<HTMLElement>('[data-header-pulse]');
    const glint = pulse?.firstElementChild as HTMLElement | null;
    const word = [...header.querySelectorAll('span')].find((n) =>
      /^(SAMPLE|LIVE)$/.test(n.textContent ?? ''),
    );
    const chip = word?.parentElement ?? null;
    const hs = getComputedStyle(header);
    const hr = header.getBoundingClientRect();
    const pr = pulse?.getBoundingClientRect();
    const gs = glint ? getComputedStyle(glint) : null;
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      headerHeight: Math.round(hr.height),
      contentRight: round(hr.right - parseFloat(hs.paddingRight)),
      present: pulse !== null,
      mode: pulse?.getAttribute('data-header-pulse') ?? null,
      ends: pulse?.getAttribute('data-pulse-ends') ?? null,
      pulse: pr ? { left: round(pr.left), right: round(pr.right), height: round(pr.height) } : null,
      // Whether anything visible in the header sits between the pulse and the chip
      // or the edge is not asserted: at wide widths the run telemetry does.
      chipLeft: chip ? round(chip.getBoundingClientRect().left) : null,
      chipRight: chip ? round(chip.getBoundingClientRect().right) : null,
      animationName: gs?.animationName ?? null,
      iteration: gs?.animationIterationCount ?? null,
      durationSeconds: gs ? parseFloat(gs.animationDuration) : null,
      clipped: pulse ? getComputedStyle(pulse).overflowX : null,
      mask: pulse ? getComputedStyle(pulse).maskImage : null,
      color: pulse ? getComputedStyle(pulse).getPropertyValue('--header-pulse-color').trim() : null,
      nominal: getComputedStyle(document.documentElement)
        .getPropertyValue('--status-nominal')
        .trim(),
    };
  });

for (const [width, height] of [
  [1280, 900],
  [390, 844],
  [320, 568],
] as const) {
  test.describe(`header pulse at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const screen of SCREENS) {
      test(`${screen.name}: a ${screen.mode} pulse that costs the header nothing`, async ({
        page,
      }) => {
        await open(page, screen.path);
        const m = await measure(page);

        expect(m.present, 'a pulse element in the header').toBe(true);
        expect(m.mode).toBe(screen.mode);
        // The header is exactly what it was.
        expect(m.headerHeight).toBe(72);
        expect(m.pageOverflow).toBe(0);
        // A hairline, clipped to its own track, so the light cannot spill out.
        expect(m.pulse!.height).toBeLessThanOrEqual(2);
        expect(m.clipped).toBe('hidden');
        expect(m.pulse!.left).toBeGreaterThanOrEqual(0);
        expect(m.pulse!.right).toBeLessThanOrEqual(m.contentRight + 0.5);
        // It runs, slowly, for ever.
        expect(m.animationName).toBe('header-pulse');
        expect(m.iteration).toBe('infinite');
        expect(m.durationSeconds).toBeGreaterThanOrEqual(8);

        if (screen.mode === 'neutral') {
          // No chip: it reaches the right edge of the bar and fades out there.
          expect(m.ends).toBe('edge');
          expect(m.chipLeft).toBeNull();
          expect(m.pulse!.right).toBeGreaterThanOrEqual(m.contentRight - 0.5);
          expect(m.mask).toContain('linear-gradient');
        } else {
          // A chip: the pulse stops short of it, and is not faded.
          expect(m.ends).toBe('chip');
          expect(m.pulse!.right).toBeLessThanOrEqual(m.chipLeft! + 0.5);
          expect(m.mask).toBe('none');
        }
      });
    }

    test('stops under prefers-reduced-motion, and leaves nothing on screen', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const screen of SCREENS) {
        await open(page, screen.path);
        const resting = await page.evaluate(() => {
          const glint = document.querySelector('header [data-header-pulse]')!
            .firstElementChild as HTMLElement;
          const cs = getComputedStyle(glint);
          return { animationName: cs.animationName, opacity: cs.opacity };
        });
        expect(resting, screen.path).toEqual({ animationName: 'none', opacity: '0' });
        expect((await measure(page)).headerHeight).toBe(72);
      }
    });
  });
}

test.describe('header pulse · the three colours', () => {
  test.skip(
    process.env.E2E_FIXTURES !== '1',
    'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
  );
  test.use({ viewport: { width: 1280, height: 900 } });

  test('live is the full nominal colour, sample is the same hue quieter, neutral is neither', async ({
    page,
  }) => {
    const colors: Record<string, string> = {};
    let nominal = '';
    for (const mode of ['live', 'sample', 'neutral'] as const) {
      await open(page, `${FIXTURE}?mode=${mode}`);
      const m = await measure(page);
      expect(m.mode, mode).toBe(mode);
      expect(m.ends, mode).toBe(mode === 'neutral' ? 'edge' : 'chip');
      expect(m.headerHeight, mode).toBe(72);
      colors[mode] = m.color!;
      nominal = m.nominal;
    }

    // The computed custom property has its tokens substituted, so the nominal
    // colour shows up in it by value.
    expect(nominal).not.toBe('');
    expect(new Set(Object.values(colors)).size).toBe(3);
    expect(colors.live).toContain(nominal);
    expect(colors.sample).toContain(nominal);
    expect(colors.sample).toContain('color-mix');
    expect(colors.neutral).not.toContain(nominal);
  });

  for (const [width, height] of [
    [1280, 900],
    [390, 844],
    [320, 568],
  ] as const) {
    test(`a LIVE chip keeps its place and the pulse stops at it, at ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await open(page, `${FIXTURE}?mode=live`);
      const m = await measure(page);

      expect(m.pageOverflow).toBe(0);
      expect(m.headerHeight).toBe(72);
      expect(m.chipRight).toBeLessThanOrEqual(width);
      expect(m.pulse!.right).toBeLessThanOrEqual(m.chipLeft! + 0.5);
      await expect(page.locator('header').getByText('LIVE', { exact: true })).toBeInViewport({
        ratio: 1,
      });
    });
  }
});
