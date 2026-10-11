import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { suppressBootSplash, WCAG } from './support/screen';

/**
 * ONE THREE-STEP SETUP FOR SIX AGENTS, IN A BROWSER.
 *
 * The unit suite holds the structure and the words. What only a browser can see
 * is layout: six tabs, one of them a long label with a tag beside it, have to
 * wrap inside a 320px phone without pushing the page sideways, each has to stay
 * a 44px target, and every tab has to open to the same three steps.
 *
 * No exact pixel sizes are asserted: Linux CI renders fonts differently from a
 * Windows desk. Floors, viewport bounds and structure only. Driven through the
 * Connect states fixture (`/e2e/connect-states`, built only with E2E_FIXTURES=1).
 */
test.skip(
  process.env.E2E_FIXTURES !== '1',
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
);

const TABS = [
  /^CLAUDE CODE$/,
  /^GITHUB COPILOT \/ VS CODE/,
  /^CURSOR/,
  /^CODEX/,
  /^GEMINI CLI/,
  /^OTHER AGENT$/,
] as const;

const setup = (page: Page) => page.getByRole('region', { name: /register .* client/i });
const picker = (page: Page) => page.getByRole('group', { name: 'MCP client' });
const panel = (page: Page) => page.locator('#connect-client-panel');

async function issued(page: Page, state: 'waiting' | 'connected' = 'waiting') {
  await suppressBootSplash(page);
  await page.goto(`/e2e/connect-states?state=${state}`);
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /issue run endpoint/i }).click();
  await expect(picker(page)).toBeVisible();
  // The issued run eases in on a transform. A box measured part way through is
  // scaled, so a 44px target reads a fraction short. Measure the resting state.
  await page
    .locator('.panel-in')
    .evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
}

/** Whether anything makes the page itself scroll sideways. */
const pageOverflow = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 320, height: 568 },
]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('the six tabs are 44px targets inside the viewport, with no sideways scroll', async ({
      page,
    }) => {
      await issued(page);

      const buttons = picker(page).getByRole('button');
      await expect(buttons).toHaveCount(6);
      for (const button of await buttons.all()) {
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        // The label is not clipped inside its own button.
        const clipped = await button.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(clipped).toBeLessThanOrEqual(1);
      }
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      await expect(page.getByTestId('chat-apps-line')).toBeVisible();
    });

    test('every tab opens to the same three steps, and none pushes the page sideways', async ({
      page,
    }) => {
      await issued(page);

      for (const tab of TABS) {
        const button = picker(page).getByRole('button', { name: tab });
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(panel(page).getByTestId('setup-step-name')).toHaveText([
          'Connect',
          'Give it the job',
          'Finish',
        ]);
        await expect(panel(page).getByTestId('config-block')).toHaveCount(1);
        await expect(panel(page).getByTestId('agent-status')).toHaveText('AWAITING AGENT');
        await expect(panel(page).getByTestId('finish-line')).toHaveText(
          'When your agent is done, End run and judge.',
        );
        expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
        // Every control the tab added is a 44px target too.
        for (const control of await panel(page).getByRole('button').all()) {
          expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        // The fixture token is copied, never drawn.
        await expect(setup(page)).not.toContainText('fixture-token-not-a-credential');
      }
    });

    test('the setup section passes axe with a tab open', async ({ page }) => {
      await issued(page);

      for (const tab of [TABS[0], TABS[3], TABS[5]]) {
        await picker(page).getByRole('button', { name: tab }).click();
        await expect(panel(page).getByTestId('setup-steps')).toBeVisible();
        const results = await new AxeBuilder({ page })
          .include('section[aria-labelledby="connect-client"]')
          .withTags(WCAG)
          .analyze();
        expect(
          results.violations.map((v) => `${v.id} x${v.nodes.length} ${v.nodes[0]?.target}`),
        ).toEqual([]);
      }
    });
  });
}

test('the UNTESTED tag is drawn in the inert colour, on tabs 2 to 5 only', async ({ page }) => {
  await issued(page);

  const tags = picker(page).getByTestId('untested-tag');
  await expect(tags).toHaveCount(4);
  const inert = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--status-inert)';
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  for (const tag of await tags.all()) {
    await expect(tag).toHaveText('UNTESTED');
    expect(await tag.evaluate((el) => getComputedStyle(el).color)).toBe(inert);
    await expect(tag.locator('svg')).toHaveCount(1);
  }
  await expect(picker(page).getByRole('button').first().getByTestId('untested-tag')).toHaveCount(0);
  await expect(picker(page).getByRole('button').last().getByTestId('untested-tag')).toHaveCount(0);
});

test('the status under step 1 follows the run: AGENT CONNECTED once the agent is there', async ({
  page,
}) => {
  await issued(page, 'connected');
  await picker(page).getByRole('button', { name: TABS[0] }).click();

  const status = panel(page).getByTestId('agent-status');
  await expect(status).toHaveText('AGENT CONNECTED');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status.locator('svg')).toHaveCount(1);
});
