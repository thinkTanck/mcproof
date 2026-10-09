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
 *
 * THE MODE CHIP IS ONLY ON RUN-SCOPED SCREENS NOW. It says where a run came
 * from (SAMPLE or LIVE), so it appears on the replay and the fix report and
 * nowhere else. Every screen is still held to no sideways scroll and a header
 * inside the viewport; the chip assertions apply to the two screens that draw it,
 * and the rest are held to drawing none.
 */

const SCREENS: { name: string; path: string; shell: boolean; chip: boolean }[] = [
  { name: 'home', path: '/', shell: true, chip: false },
  { name: 'sign-in', path: '/sign-in', shell: false, chip: false },
  { name: 'connect', path: '/connect', shell: true, chip: false },
  { name: 'replay', path: '/runs/sample', shell: true, chip: true },
  { name: 'findings', path: '/findings/sample', shell: true, chip: true },
  { name: 'leaderboard', path: '/leaderboard', shell: true, chip: false },
  { name: 'threats', path: '/threats', shell: true, chip: false },
];

const chipIn = (page: Page) => header(page).getByText(/^(SAMPLE|LIVE)$/);

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
      test(`${screen.name}: no sideways scroll, header inside the viewport, ${screen.chip ? 'SAMPLE visible' : 'no mode chip'}`, async ({
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

        if (!screen.chip) {
          // No run on this screen, so nothing to say about where one came from.
          await expect(chipIn(page)).toHaveCount(0);
          return;
        }

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
        const logo = el.querySelector('a[aria-label="MCProof home"]') as HTMLElement;
        const spacer = [...el.children].find((c) => c.classList.contains('flex-1')) as HTMLElement;
        // The chip is the pill that holds the mode word, when the screen has one.
        // The pill and the word inside it both read SAMPLE or LIVE: take the word,
        // the innermost match, so its parent is the pill.
        const word = [...el.querySelectorAll('span')]
          .filter((n) => /^(SAMPLE|LIVE)$/.test(n.textContent ?? ''))
          .pop();
        const chip = (word?.parentElement ?? null) as HTMLElement | null;
        const chipCs = chip ? getComputedStyle(chip) : null;
        return {
          padding: `${cs.paddingLeft} ${cs.paddingRight}`,
          gap: cs.columnGap,
          height: Math.round(el.getBoundingClientRect().height),
          logoLeft: Math.round(logo.getBoundingClientRect().left),
          logoGap: getComputedStyle(logo).columnGap,
          spacerShown: getComputedStyle(spacer).display !== 'none',
          chip:
            chip && chipCs
              ? {
                  right: Math.round(chip.getBoundingClientRect().right),
                  padding: `${chipCs.paddingLeft} ${chipCs.paddingRight}`,
                  gap: chipCs.columnGap,
                  margin: chipCs.marginLeft,
                }
              : null,
        };
      });
      // The values the desktop header had before #176, measured in the fallback
      // font. The chip's own values hold on the screens that draw it.
      expect(m, screen.path).toEqual({
        padding: '18px 18px',
        gap: '16px',
        height: 72,
        logoLeft: 18,
        logoGap: '10px',
        spacerShown: true,
        chip: screen.chip ? { right: 1262, padding: '12px 12px', gap: '8px', margin: '0px' } : null,
      });
    }
  });
});
