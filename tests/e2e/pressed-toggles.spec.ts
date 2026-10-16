import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * A PRESSED TOGGLE SAYS SO WITHOUT ITS GLOW (Batch F, owner ruling 2026-10-14).
 *
 * A pressed toggle may glow at rest only if the pressed state also shows with
 * the glow taken away, by its border or its fill, and is announced with
 * `aria-pressed`. Each group is measured with every shadow switched off: the
 * pressed button must still differ from an unpressed one in border colour or
 * background colour, and every button in the group carries `aria-pressed`.
 */

const GROUPS = [
  { page: '/connect', group: 'Run mode' },
  { page: '/e2e/connect-states?state=waiting', group: 'MCP client', issue: true, choose: true },
  { page: '/runs/sample', group: 'Playback speed' },
] as const;

async function open(page: Page, path: string) {
  await suppressBootSplash(page);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [390, 1280]) {
  test.describe(`pressed toggles at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const { page: path, group, ...rest } of GROUPS) {
      test(`${path}, ${group}: the pressed state shows without its glow`, async ({ page }) => {
        await open(page, path);
        // The client picker is drawn once a live run is issued, as a reader gets there.
        if ('issue' in rest && rest.issue) {
          await page.getByRole('button', { name: /^LIVE/ }).click();
          await page.getByRole('button', { name: /start a run/i }).click();
        }
        const buttons = page.getByRole('group', { name: group }).getByRole('button');
        await expect(buttons.first()).toBeVisible();
        // A group where nothing is pressed until the reader chooses: choose one.
        if ('choose' in rest && rest.choose) await buttons.first().click();

        const m = await page.getByRole('group', { name: group }).evaluate((el) => {
          const style = document.createElement('style');
          style.textContent = '* { box-shadow: none !important; }';
          document.head.append(style);
          const all = [...el.querySelectorAll('button')];
          const look = (b: Element) => {
            const s = getComputedStyle(b);
            return { border: s.borderTopColor, fill: s.backgroundColor, shadow: s.boxShadow };
          };
          const pressed = all.filter((b) => b.getAttribute('aria-pressed') === 'true');
          const unpressed = all.filter((b) => b.getAttribute('aria-pressed') === 'false');
          const result = {
            count: all.length,
            announced: all.every((b) => b.hasAttribute('aria-pressed')),
            pressed: pressed.map(look),
            unpressed: unpressed.map(look),
          };
          style.remove();
          return result;
        });

        expect(m.count).toBeGreaterThan(1);
        expect(m.announced, 'every button carries aria-pressed').toBe(true);
        expect(m.pressed, 'one button is pressed').toHaveLength(1);
        expect(m.unpressed.length).toBeGreaterThan(0);
        const on = m.pressed[0]!;
        expect(on.shadow, 'the glow is off for this check').toBe('none');
        for (const off of m.unpressed) {
          expect(
            on.border !== off.border || on.fill !== off.fill,
            'pressed differs from unpressed by border or fill, with no glow',
          ).toBe(true);
        }
      });
    }
  });
}
