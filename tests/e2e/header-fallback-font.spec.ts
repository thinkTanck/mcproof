import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE SHARED HUD HEADER FITS A PHONE IN THE FALLBACK FONT (issue #176).
 *
 * Geist loads with `display: 'optional'` (src/app/layout.tsx), so a first visit
 * that misses the font keeps next/font's wider fallback for the page's whole
 * lifetime. In that font the header used to overflow every shell screen, by 27px
 * at 360 and 12px at 375, pushing the SAMPLE chip past the edge. `optional` stays:
 * it is what keeps CLS near zero. The header makes the room instead.
 *
 * Blocking the font file pins the fallback, the worst case a first-time visitor
 * sees, the same way tests/e2e/connect-run-bar.spec.ts does. A warm cache can
 * only make the header narrower.
 *
 * 320x568 is the WCAG 1.4.10 Reflow case: a 1280px window at 400% zoom lays out
 * at 320 CSS px, and content has to reflow there without a sideways scroll. In
 * the fallback font the header needed 351px at that width, 31px too many.
 */

const SCREENS: { name: string; path: string; shell: boolean }[] = [
  { name: 'home', path: '/', shell: true },
  { name: 'sign-in', path: '/sign-in', shell: false },
  { name: 'connect', path: '/connect', shell: true },
  { name: 'replay', path: '/runs/sample', shell: true },
  { name: 'findings', path: '/findings/sample', shell: true },
  { name: 'leaderboard', path: '/leaderboard', shell: true },
  { name: 'threats', path: '/threats', shell: true },
];

const header = (page: Page) => page.locator('header').first();

async function openInFallbackFont(page: Page, path: string) {
  await page.context().route(/\.woff2?(\?|$)/, (route) => route.abort());
  await suppressBootSplash(page);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

for (const [width, height] of [
  [320, 568],
  [360, 640],
  [375, 667],
] as const) {
  test.describe(`header in the fallback font at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const screen of SCREENS) {
      test(`${screen.name}: no sideways scroll, header inside the viewport, SAMPLE visible`, async ({
        page,
      }) => {
        await openInFallbackFont(page, screen.path);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${screen.path} scrolls sideways by ${overflow}px`).toBe(0);

        if (!screen.shell) {
          // Sign-in renders outside the shared shell: no HUD header to fit.
          await expect(page.locator('header')).toHaveCount(0);
          return;
        }

        // Every visible header item sits wholly inside the viewport.
        const outside = await header(page).evaluate((el) => {
          const vw = document.documentElement.clientWidth;
          return [...el.children]
            .filter((child) => child.getBoundingClientRect().width > 0)
            .filter((child) => {
              const r = child.getBoundingClientRect();
              return r.left < 0 || r.right > vw + 0.5;
            })
            .map((child) => (child.getAttribute('aria-label') ?? child.textContent ?? '').trim());
        });
        expect(outside, 'header items past the viewport edge').toEqual([]);

        // The mode chip keeps its full word, fully on screen.
        const chip = header(page).getByText('SAMPLE', { exact: true });
        await expect(chip).toBeVisible();
        await expect(chip).toBeInViewport({ ratio: 1 });
      });
    }
  });
}

test.describe('header at 1280x900 is unchanged', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('keeps the desktop padding, gaps, spacer and positions on every shell screen', async ({
    page,
  }) => {
    for (const screen of SCREENS.filter((s) => s.shell)) {
      await openInFallbackFont(page, screen.path);
      const m = await header(page).evaluate((el) => {
        const cs = getComputedStyle(el);
        const logo = el.querySelector('a[aria-label="MCPwn home"]') as HTMLElement;
        const chip = el.lastElementChild as HTMLElement;
        const spacer = [...el.children].find((c) => c.classList.contains('flex-1')) as HTMLElement;
        const chipCs = getComputedStyle(chip);
        return {
          padding: `${cs.paddingLeft} ${cs.paddingRight}`,
          gap: cs.columnGap,
          height: Math.round(el.getBoundingClientRect().height),
          logoLeft: Math.round(logo.getBoundingClientRect().left),
          logoGap: getComputedStyle(logo).columnGap,
          spacerShown: getComputedStyle(spacer).display !== 'none',
          chipRight: Math.round(chip.getBoundingClientRect().right),
          chipPadding: `${chipCs.paddingLeft} ${chipCs.paddingRight}`,
          chipGap: chipCs.columnGap,
          chipMargin: chipCs.marginLeft,
        };
      });
      // The values the desktop header had before #176, measured in the fallback font.
      expect(m, screen.path).toEqual({
        padding: '18px 18px',
        gap: '16px',
        height: 72,
        logoLeft: 18,
        logoGap: '10px',
        spacerShown: true,
        chipRight: 1262,
        chipPadding: '12px 12px',
        chipGap: '8px',
        chipMargin: '0px',
      });
    }
  });
});
