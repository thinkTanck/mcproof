import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { suppressBootSplash, WCAG } from './support/screen';
import {
  claudeCodeConfig,
  codexConfig,
  cursorConfig,
  geminiConfig,
  genericConfig,
  vsCodeConfig,
} from '../../src/lib/mcp/config';

/**
 * WHEN COPYING FAILS, SHOW CONFIG PUTS A WORKING CONFIG ON SCREEN, IN A BROWSER.
 *
 * A config block draws its token as a mask and copies the real one. When the
 * clipboard refuses, the box offers SHOW CONFIG, and only then, on the reader's
 * press, draws the real config as selectable text beside "This contains your run
 * token. Do not share it." The unit suite holds the rules; this holds what only a
 * browser can: the drawn text is exactly the config a copy would have written,
 * the box still fits a 320px phone without pushing the page sideways, the button
 * is a 44px target, and the section passes axe with the config revealed.
 *
 * The clipboard is refused by replacing `navigator.clipboard` with one whose
 * write rejects, as a denied permission does. Driven through the Connect states
 * fixture (`/e2e/connect-states`, built only with E2E_FIXTURES=1), whose
 * endpoint and token are invented. No exact pixel sizes are asserted.
 */
test.skip(
  process.env.E2E_FIXTURES !== '1',
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
);

/** The fixture's invented run (`src/app/(hud)/e2e/connect-states/fixture.tsx`). */
const ENDPOINT = 'https://example.invalid/api/mcp/fixture-run';
const TOKEN = 'fixture-token-not-a-credential';
const WARNING = 'This contains your run token. Do not share it.';

const TABS = [
  { tab: /^CLAUDE CODE$/, build: claudeCodeConfig },
  { tab: /^GITHUB COPILOT \/ VS CODE/, build: vsCodeConfig },
  { tab: /^CURSOR/, build: cursorConfig },
  { tab: /^CODEX/, build: codexConfig },
  { tab: /^GEMINI CLI/, build: geminiConfig },
  { tab: /^OTHER AGENT$/, build: genericConfig },
] as const;

const picker = (page: Page) => page.getByRole('group', { name: 'MCP client' });
const panel = (page: Page) => page.locator('#connect-client-panel');
const block = (page: Page) => panel(page).getByTestId('config-block');

async function issued(page: Page) {
  await suppressBootSplash(page);
  await page.goto('/e2e/connect-states?state=waiting');
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /start a run/i }).click();
  await expect(picker(page)).toBeVisible();
  await page
    .locator('.panel-in')
    .evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
}

/** Refuse every clipboard write from here on, as a denied permission does. */
async function denyClipboard(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      },
    });
  });
}

/**
 * Press a control. Playwright's Windows WebKit build stalls on the click
 * "stable" check on this screen (it hung on the pre-existing COPY button as
 * often as on the new one), so in WebKit the click is dispatched to the element
 * once it is visible. Chromium gets a real pointer click, and SHOW CONFIG is
 * pressed from the keyboard there, to prove it is reachable that way.
 */
async function press(
  control: Locator,
  browserName: string,
  via: 'pointer' | 'keyboard' = 'pointer',
) {
  await expect(control).toBeVisible();
  if (browserName === 'webkit') return control.dispatchEvent('click');
  if (via === 'keyboard') {
    await control.focus();
    return control.page().keyboard.press('Enter');
  }
  return control.click();
}

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 320, height: 568 },
]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('on every tab, SHOW CONFIG draws exactly the config a copy would have written', async ({
      page,
      browserName,
    }) => {
      await issued(page);
      await denyClipboard(page);

      for (const { tab, build } of TABS) {
        await press(picker(page).getByRole('button', { name: tab }), browserName);
        await expect(block(page).getByRole('button', { name: 'SHOW CONFIG' })).toHaveCount(0);

        await press(block(page).getByRole('button', { name: /^copy /i }), browserName);
        const show = block(page).getByRole('button', { name: 'SHOW CONFIG' });
        await expect(show).toBeVisible();
        // A failed copy alone draws nothing.
        await expect(page.locator('body')).not.toContainText(TOKEN);

        await press(show, browserName, 'keyboard');
        const drawn = block(page).locator('pre');
        expect(await drawn.textContent()).toBe(build(ENDPOINT, TOKEN));
        await expect(block(page).getByText(WARNING)).toBeVisible();

        // Selectable, scrolled inside its own box, and the page does not move.
        expect(await drawn.evaluate((el) => getComputedStyle(el).userSelect)).not.toBe('none');
        expect(await drawn.evaluate((el) => getComputedStyle(el).overflowX)).toBe('auto');
        expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
        const hide = block(page).getByRole('button', { name: 'HIDE CONFIG' });
        const box = (await hide.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

        await press(hide, browserName);
        await expect(page.locator('body')).not.toContainText(TOKEN);
      }
    });

    test('the setup section passes axe with the config revealed', async ({ page, browserName }) => {
      await issued(page);
      await denyClipboard(page);
      await press(picker(page).getByRole('button', { name: TABS[3].tab }), browserName);
      await press(block(page).getByRole('button', { name: /^copy /i }), browserName);
      await press(block(page).getByRole('button', { name: 'SHOW CONFIG' }), browserName);
      await expect(block(page).getByText(WARNING)).toBeVisible();

      const results = await new AxeBuilder({ page })
        .include('section[aria-labelledby="connect-client"]')
        .withTags(WCAG)
        .analyze();
      expect(
        results.violations.map((v) => `${v.id} x${v.nodes.length} ${v.nodes[0]?.target}`),
      ).toEqual([]);
    });
  });
}

test('with the clipboard working, SHOW CONFIG never appears and the token is never drawn', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'WebKit refuses the clipboard permission this needs.');
  await issued(page);
  for (const { tab } of TABS) {
    await picker(page).getByRole('button', { name: tab }).click();
    await block(page)
      .getByRole('button', { name: /^copy /i })
      .click();
    await expect(block(page).getByText('COPIED')).toBeVisible();
    await expect(panel(page).getByRole('button', { name: /^SHOW / })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(TOKEN);
  }
});
