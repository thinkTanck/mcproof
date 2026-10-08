import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * A FILE NAME IS SHOWN IN THE CASE IT HAS TO BE TYPED (sweep 2026-10-07, C6).
 *
 * The snippet labels are uppercase micro-labels, so `SAVE AS run-mcp.json` was
 * DRAWN as `SAVE AS RUN-MCP.JSON`, above a command that loads `run-mcp.json`.
 * On a case-sensitive file system those are two different files.
 *
 * The casing is applied by CSS, so only a browser can see it: `innerText` is the
 * text as rendered, transform included. Driven through the Connect states
 * fixture (`/e2e/connect-states`, built only with E2E_FIXTURES=1).
 */
test.skip(
  process.env.E2E_FIXTURES !== '1',
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
);

async function openTab(page: Page, name: string) {
  await suppressBootSplash(page);
  await page.goto('/e2e/connect-states?state=waiting');
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /issue run endpoint/i }).click();
  await page.getByRole('group', { name: 'MCP client' }).getByRole('button', { name }).click();
}

/** The rendered text of every snippet label in the client panel. */
const labels = (page: Page) =>
  page
    .locator('#connect-client-panel .micro-label')
    .evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
    );

test('Claude Code: the label shows run-mcp.json as the command spells it', async ({ page }) => {
  await openTab(page, 'CLAUDE CODE');

  const rendered = await labels(page);
  expect(rendered).toContain('SAVE AS run-mcp.json');
  expect(rendered.join(' | ')).not.toContain('RUN-MCP.JSON');
  // And it is the file the next step's command loads.
  await expect(
    page.getByText('claude --strict-mcp-config --mcp-config run-mcp.json', { exact: true }),
  ).toBeVisible();
});

test('Cursor and VS Code: the labels show the config paths in lower case', async ({ page }) => {
  await openTab(page, 'CURSOR / VS CODE');

  const rendered = await labels(page);
  expect(rendered).toContain('CURSOR · .cursor/mcp.json');
  expect(rendered).toContain('VS CODE · .vscode/mcp.json');
  expect(rendered.join(' | ')).not.toMatch(/\.CURSOR|\.VSCODE|MCP\.JSON/);
});

test('the rest of each label is still an uppercase micro-label', async ({ page }) => {
  await openTab(page, 'CLAUDE CODE');

  const rendered = await labels(page);
  expect(rendered).toContain('TERMINAL ROUTE');
  expect(rendered).toContain('BASH AND POWERSHELL');
});
