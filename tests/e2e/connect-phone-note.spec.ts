import { test, expect, type Locator, type Page } from '@playwright/test';
import { expectNoWcagViolations, gotoOk, suppressBootSplash } from './support/screen';

/**
 * THE PHONE NOTE ON CONNECT, IN A REAL BROWSER.
 *
 * Running a test needs a terminal or a code editor. Below 768px `/connect`
 * says so first and points at the three things a phone visitor can do. The
 * unit suite holds the words and the class contract; whether the note is
 * really drawn on a phone and really gone on a desk depends on a media query,
 * which jsdom does not apply, so that is measured here in Chromium.
 *
 * No exact pixel sizes: floors, viewport bounds and relations only.
 */
const TEXT =
  'Running a test needs a computer with a terminal or code editor. From your phone you can watch a sample run, read a fix report, and check the leaderboard.';

const LINKS = [
  ['Watch a sample run', '/runs/sample'],
  ['Read a fix report', '/findings/sample'],
  ['See the leaderboard', '/leaderboard'],
] as const;

const note = (page: Page) => page.getByRole('note');
const sample = (page: Page) => page.getByRole('button', { name: /^SAMPLE/ });
const live = (page: Page) => page.getByRole('button', { name: /^LIVE/ });

async function open(page: Page, path = '/connect') {
  await suppressBootSplash(page);
  await gotoOk(page, path);
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error('not drawn');
  return { ...b, right: b.x + b.width, bottom: b.y + b.height };
}

async function expectNoSidewaysScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test.describe(`on a phone, ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('the note is shown above the mode switch, with three full-size links', async ({
      page,
    }) => {
      await open(page);

      await expect(note(page)).toHaveCount(1);
      await expect(note(page)).toBeVisible();
      await expect(note(page).getByText(TEXT)).toBeVisible();
      // No label above the sentence.
      await expect(note(page)).not.toContainText(/on a phone/i);

      const n = await box(note(page));
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.right).toBeLessThanOrEqual(viewport.width + 0.5);
      // Above the mode switch, not over it.
      expect(n.bottom).toBeLessThanOrEqual((await box(sample(page))).y + 0.5);

      const boxes = [];
      for (const [label] of LINKS) {
        const link = note(page).getByRole('link', { name: label, exact: true });
        await expect(link).toBeVisible();
        const b = await box(link);
        expect(b.height).toBeGreaterThanOrEqual(44);
        expect(b.width).toBeGreaterThanOrEqual(44);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.right).toBeLessThanOrEqual(viewport.width + 0.5);
        // The label is not clipped inside its own link.
        expect(await link.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        boxes.push(b);
      }
      // The three do not crowd each other: no two targets touch or overlap.
      for (let i = 1; i < boxes.length; i += 1) {
        const [a, b] = [boxes[i - 1]!, boxes[i]!];
        const apart = b.y >= a.bottom + 4 || b.x >= a.right + 4;
        expect(apart, `"${LINKS[i]![0]}" is clear of "${LINKS[i - 1]![0]}"`).toBe(true);
      }
      await expectNoSidewaysScroll(page);
    });

    test('the mode switch still works, and the note stays in LIVE mode', async ({ page }) => {
      await open(page);

      await expect(sample(page)).toBeVisible();
      await expect(live(page)).toBeVisible();
      await expect(sample(page)).toHaveAttribute('aria-pressed', 'true');

      await live(page).click();
      await expect(live(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(sample(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(note(page)).toBeVisible();
      await expect(note(page).getByRole('link')).toHaveCount(3);
      // The rest of the screen is still there to use.
      await expect(
        page.getByRole('radiogroup', { name: /attack category/i }).getByRole('radio'),
      ).toHaveCount(7);
      await expect(page.getByRole('link', { name: /sign in/i }).first()).toBeVisible();
      await expectNoSidewaysScroll(page);

      await sample(page).click();
      await expect(sample(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('link', { name: /play sample run/i })).toBeVisible();
    });

    test('the note takes no focus and holds none', async ({ page }) => {
      await open(page);

      // Nothing is focused on arrival, and Tab walks through the three links and out.
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
      const last = note(page).getByRole('link', { name: LINKS[2][0], exact: true });
      await last.focus();
      await page.keyboard.press('Tab');
      await expect(sample(page)).toBeFocused();
    });

    for (const [label, target] of LINKS) {
      test(`"${label}" goes to ${target}`, async ({ page }) => {
        await open(page);

        await note(page).getByRole('link', { name: label, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${target}$`));
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      });
    }
  });
}

test.describe('axe, 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('WCAG A/AA is clean with the note showing, in both modes', async ({ page }) => {
    await open(page);
    await expect(note(page)).toBeVisible();
    await expectNoWcagViolations(page);

    await live(page).click();
    await expect(note(page)).toBeVisible();
    await expectNoWcagViolations(page);
  });
});

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
]) {
  test.describe(`from 768px up, ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('the note is absent: not drawn, and not in the accessibility tree', async ({ page }) => {
      await open(page);

      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // `getByRole` reads the accessibility tree, so a count of zero means absent from it.
      await expect(note(page)).toHaveCount(0);
      await expect(page.getByText(TEXT)).toBeHidden();
      for (const [label] of LINKS) {
        await expect(page.getByRole('link', { name: label, exact: true })).toHaveCount(0);
      }
      // Really out of layout, not merely transparent or clipped.
      const display = await page
        .getByText(TEXT)
        .evaluate((el) => getComputedStyle(el.closest('[role="note"]')!).display);
      expect(display).toBe('none');
      await expect(sample(page)).toBeVisible();
    });
  });
}

/**
 * The fixture-driven Connect states draw the same screen, so they carry the
 * note as well, and it must not disturb a run that has been issued.
 */
test.describe('the Connect states fixture, 320x568', () => {
  test.skip(
    process.env.E2E_FIXTURES !== '1',
    'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
  );
  test.use({ viewport: { width: 320, height: 568 } });

  test('the note is shown with a run issued, and the page still fits the screen', async ({
    page,
  }) => {
    await open(page, '/e2e/connect-states?state=connected');
    await expect(note(page)).toBeVisible();

    await live(page).click();
    await page.getByRole('button', { name: /issue run endpoint/i }).click();
    await expect(
      page
        .getByRole('region', { name: /what we have actually seen/i })
        .getByText('AGENT CONNECTED'),
    ).toBeVisible();

    await expect(note(page)).toHaveCount(1);
    await expect(note(page).getByRole('link')).toHaveCount(3);
    await expectNoSidewaysScroll(page);
  });
});
