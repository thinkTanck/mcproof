import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE RAIL NAMES ITS LINKS IN WORDS ON A TABLET, NOT ONLY ON HOVER (S4).
 *
 * From 760 to 1099px wide (tablets, and phones held sideways) the command deck
 * is a narrow rail. It showed icons only, named by `aria-label` and `title`,
 * and a touch screen has no tooltip: six glyphs and the account glyph had to be
 * guessed. Each control now shows a short word under its icon.
 *
 * Measured in Chromium and WebKit (an iPhone, which is the engine on every iPad
 * too), at every viewport in the sweep that falls inside the band:
 *  - every control shows visible text, and that text is inside its accessible
 *    name (WCAG 2.5.3 Label in Name);
 *  - the accessible name is exactly what it was before;
 *  - every control is at least 44px tall and wide;
 *  - the words are not clipped, and the page does not scroll sideways.
 *
 * And a guard either side of the band: below 760 (the drawer) and at 1100 and
 * up (the wide rail) the deck is drawn as it was.
 *
 * Next/font's fallback is pinned by blocking the font files: it is the wider of
 * the two faces, so it is the worst case for a word fitting the rail. No exact
 * pixel sizes: floors, containment and small tolerances only.
 */

/** Every viewport in the sweep that is 760 to 1099px wide. */
const IN_BAND = [
  { width: 768, height: 1024 },
  { width: 1024, height: 1366 },
  { width: 844, height: 390 },
  { width: 1024, height: 768 },
] as const;

/** Screens whose main column is the widest, so the rail growing would show there first. */
const PAGES = ['/', '/connect', '/runs/sample', '/leaderboard'] as const;

/** The deck's names, unchanged, and the build has no auth configured (CI and here). */
const EXPECTED_NAMES = [
  'Home',
  'Connect / Run. point your own agent at an endpoint and run it',
  'Live Replay. watch a recorded attack step by step',
  'Leaderboard',
  'Findings',
  'Threat Model',
  'Sign in. Preview: sign-in is not set up on this build.',
] as const;

/** The full words the wide rail and the drawer show, as before. */
const FULL_LABELS = [
  'Home',
  'Connect / Run',
  'Live Replay',
  'Leaderboard',
  'Findings',
  'Threat Model',
] as const;

/** 44px, less a hair for sub-pixel layout. */
const MIN_TARGET = 43.5;

async function open(page: Page, path: string, viewport: { width: number; height: number }) {
  await suppressBootSplash(page);
  await page.context().route(/\.woff2?(\?|$)/, (route) => route.abort());
  await page.setViewportSize(viewport);
  await page.goto(path);
  await expect(page.locator('h1').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const rail = (page: Page) => page.getByRole('navigation', { name: 'Command deck', exact: true });

/** Every control in the rail: the six destinations and the account entry. */
const railControls = (page: Page) => rail(page).locator('a, button');

type Measured = {
  visible: string;
  control: { w: number; h: number };
  clipped: string[];
};

/** What a sighted reader sees of each rail control, and whether any of it is cut off. */
function measureRail(page: Page): Promise<Measured[]> {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Command deck"]')!;
    const navBox = nav.getBoundingClientRect();
    return [...nav.querySelectorAll('a, button')].map((el) => {
      const box = el.getBoundingClientRect();
      const clipped: string[] = [];
      for (const span of el.querySelectorAll('span')) {
        const style = getComputedStyle(span);
        if (style.display === 'none' || !span.textContent?.trim()) continue;
        const r = span.getBoundingClientRect();
        if (r.width === 0) continue;
        const label = span.textContent.trim();
        if (span.scrollWidth > span.clientWidth + 1 && style.display !== 'inline') {
          clipped.push(`${label}: scrolls`);
        }
        if (r.left < box.left - 1 || r.right > box.right + 1)
          clipped.push(`${label}: past control`);
        if (r.left < navBox.left - 1 || r.right > navBox.right + 1)
          clipped.push(`${label}: past rail`);
      }
      return {
        visible: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
        control: { w: box.width, h: box.height },
        clipped,
      };
    });
  });
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const viewport of IN_BAND) {
  test.describe(`narrow rail at ${viewport.width}x${viewport.height}`, () => {
    for (const path of PAGES) {
      test(`${path}: every control is named in words a touch reader can see`, async ({ page }) => {
        await open(page, path, viewport);
        await expect(rail(page)).toBeVisible();

        const controls = railControls(page);
        await expect(controls).toHaveCount(EXPECTED_NAMES.length);
        for (const [i, name] of EXPECTED_NAMES.entries()) {
          await expect(controls.nth(i)).toHaveAccessibleName(name);
        }

        const measured = await measureRail(page);
        for (const [i, m] of measured.entries()) {
          const name = EXPECTED_NAMES[i]!;
          expect(m.visible, `${name}: shows a word`).not.toBe('');
          expect(name.toLowerCase(), `${name}: Label in Name`).toContain(m.visible.toLowerCase());
          expect(m.control.h, `${name}: height`).toBeGreaterThanOrEqual(MIN_TARGET);
          expect(m.control.w, `${name}: width`).toBeGreaterThanOrEqual(MIN_TARGET);
          expect(m.clipped, `${name}: clipped`).toEqual([]);
        }

        expect(await sideways(page), 'sideways scroll').toBeLessThanOrEqual(0);
      });
    }
  });
}

test.describe('outside the band nothing changes', () => {
  test('below 760 the rail is not drawn and the drawer shows its full words', async ({ page }) => {
    await open(page, '/', { width: 390, height: 844 });
    await expect(rail(page)).toBeHidden();
    await page.getByRole('button', { name: 'Open command deck' }).click();
    const drawer = page.getByRole('navigation', { name: 'Command deck (mobile)' });
    await expect(drawer).toBeVisible();
    const words = await drawer
      .locator('a')
      .evaluateAll((links) => links.map((a) => (a as HTMLElement).innerText.trim()));
    expect(words).toEqual([...FULL_LABELS]);
    // Still a row: icon beside the word.
    const directions = await drawer
      .locator('a')
      .evaluateAll((links) => links.map((a) => getComputedStyle(a).flexDirection));
    expect(new Set(directions)).toEqual(new Set(['row']));
    expect(await page.locator('#mobile-deck [data-rail-label]').count()).toBe(0);
  });

  for (const width of [1100, 1280]) {
    test(`at ${width} the wide rail shows the full words in a row`, async ({ page }) => {
      await open(page, '/', { width, height: 900 });
      await expect(rail(page)).toBeVisible();
      await expect(rail(page).getByText('COMMAND DECK')).toBeVisible();
      const controls = railControls(page);
      for (const [i, name] of EXPECTED_NAMES.entries()) {
        await expect(controls.nth(i)).toHaveAccessibleName(name);
      }
      const measured = await measureRail(page);
      expect(measured.slice(0, FULL_LABELS.length).map((m) => m.visible)).toEqual([...FULL_LABELS]);
      const directions = await controls.evaluateAll((els) =>
        els.map((el) => getComputedStyle(el).flexDirection),
      );
      expect(new Set(directions)).toEqual(new Set(['row']));
      // The short words are not drawn here.
      const shown = await rail(page)
        .locator('[data-rail-label]')
        .evaluateAll((els) => els.filter((el) => getComputedStyle(el).display !== 'none').length);
      expect(shown).toBe(0);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
    });
  }
});
