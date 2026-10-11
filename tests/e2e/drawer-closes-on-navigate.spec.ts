import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE DRAWER CLOSES WHEN YOU GO SOMEWHERE (mobile sweep 2026-10-10, S2).
 *
 * Below 760px the command deck is a drawer: a native popover in the shell
 * layout. Next does not re-render a layout on a client navigation, so tapping a
 * destination changed the URL and left the drawer open over the new page, in
 * both engines. The reader saw the menu, not the page they asked for.
 *
 * THE RULE, at phone sizes, in Chromium and WebKit (an iPhone):
 *  - a tap on any destination in the drawer takes you there and the drawer is
 *    closed: not visible, not in the accessibility tree, not `:popover-open`;
 *  - focus is back on the menu button that opened it;
 *  - the account entry (Sign in) leaves the app shell altogether, so there the
 *    check is that no drawer came along, and that Back finds it closed;
 *  - a route change the drawer did not cause (Back) closes it as well;
 *  - nothing scrolls sideways.
 *
 * No pixel sizes: everything here is structural.
 */

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;

const MENU = 'Open command deck';

function menuButton(page: Page) {
  return page.getByRole('button', { name: MENU });
}

function drawer(page: Page) {
  return page.locator('#mobile-deck');
}

async function openDrawer(page: Page) {
  await menuButton(page).tap();
  await expect(drawer(page)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Command deck (mobile)' })).toBeVisible();
}

async function expectClosedWithFocusOnMenu(page: Page) {
  await expect(drawer(page)).toBeHidden();
  // Hidden from assistive technology too: role queries skip what is hidden.
  await expect(page.getByRole('navigation', { name: 'Command deck (mobile)' })).toHaveCount(0);
  expect(await drawer(page).evaluate((el) => el.matches(':popover-open'))).toBe(false);
  await expect(menuButton(page)).toBeFocused();
}

async function sidewaysOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await suppressBootSplash(page);
});

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('every link tapped in the drawer lands on its page with the drawer closed', async ({
      page,
    }) => {
      await page.goto('/connect');

      const destinations = [
        { name: 'Leaderboard', url: /\/leaderboard$/ },
        { name: /^Threat Model/, url: /\/threats$/ },
        { name: 'Home', url: /\/$/ },
        { name: /^Connect \/ Run/, url: /\/connect$/ },
      ];
      for (const { name, url } of destinations) {
        await openDrawer(page);
        await drawer(page).getByRole('link', { name }).first().tap();

        await expect(page).toHaveURL(url);
        await expectClosedWithFocusOnMenu(page);
        expect(await sidewaysOverflow(page)).toBe(0);
      }
    });

    test('the account entry (Sign in) leaves the shell, and Back finds the drawer closed', async ({
      page,
    }) => {
      await page.goto('/connect');
      await openDrawer(page);

      // Sign in for a signed-out visitor; on a build with no auth configured the
      // same link, marked PREVIEW. The sign-in page sits outside the app shell,
      // so there is no drawer and no menu button left to hold focus.
      await drawer(page)
        .getByRole('link', { name: /^Sign in/ })
        .tap();

      await expect(page).toHaveURL(/\/sign-in\?next=%2Fconnect$/);
      await expect(drawer(page)).toHaveCount(0);
      await expect(menuButton(page)).toHaveCount(0);
      expect(await sidewaysOverflow(page)).toBe(0);

      await page.goBack();

      await expect(page).toHaveURL(/\/connect$/);
      await expect(drawer(page)).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Command deck (mobile)' })).toHaveCount(0);
    });

    test('tapping the page you are already on closes the drawer as well', async ({ page }) => {
      await page.goto('/leaderboard');
      await openDrawer(page);

      await drawer(page).getByRole('link', { name: 'Leaderboard' }).tap();

      await expect(page).toHaveURL(/\/leaderboard$/);
      await expectClosedWithFocusOnMenu(page);
    });

    test('Back after a trip through the drawer leaves the drawer closed', async ({ page }) => {
      await page.goto('/connect');
      await openDrawer(page);
      await drawer(page).getByRole('link', { name: 'Leaderboard' }).tap();
      await expect(page).toHaveURL(/\/leaderboard$/);

      await page.goBack();

      await expect(page).toHaveURL(/\/connect$/);
      await expect(drawer(page)).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Command deck (mobile)' })).toHaveCount(0);
      expect(await sidewaysOverflow(page)).toBe(0);
    });

    test('Back with the drawer open closes it and puts focus on the menu button', async ({
      page,
    }) => {
      await page.goto('/connect');
      // A client navigation first, so Back is a client navigation too.
      await openDrawer(page);
      await drawer(page).getByRole('link', { name: 'Leaderboard' }).tap();
      await expect(page).toHaveURL(/\/leaderboard$/);
      await openDrawer(page);

      await page.goBack();

      await expect(page).toHaveURL(/\/connect$/);
      await expectClosedWithFocusOnMenu(page);
      expect(await sidewaysOverflow(page)).toBe(0);
    });

    test('a link outside the drawer (the wordmark) leaves it closed on the new page', async ({
      page,
    }) => {
      await page.goto('/connect');
      await openDrawer(page);

      await page.getByRole('link', { name: 'MCProof home' }).tap();

      await expect(page).toHaveURL(/\/$/);
      await expect(drawer(page)).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Command deck (mobile)' })).toHaveCount(0);
      expect(await sidewaysOverflow(page)).toBe(0);
    });

    test('Escape still closes the drawer', async ({ page }) => {
      await page.goto('/connect');
      await openDrawer(page);

      await page.keyboard.press('Escape');

      await expect(drawer(page)).toBeHidden();
      await expect(page).toHaveURL(/\/connect$/);
    });
  });
}
