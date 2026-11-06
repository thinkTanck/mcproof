import { defineConfig, devices } from '@playwright/test';

/**
 * DIAGNOSTICS ONLY, never part of the gate. A separate test directory, so the
 * main config (`testDir: ./tests/e2e`) never collects these specs. Run on
 * purpose, in a CI diagnostic workflow, against the same built app the e2e
 * step serves:
 *
 *   npx playwright test -c playwright.diagnostics.config.ts --project=webkit \
 *     --workers=1 --retries=0 --repeat-each=20
 *
 * Each run attaches its own record (`about-clock.json`) whether it passes or
 * fails, so a stretched run can be read back from the report.
 */
const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e-diagnostics',
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-diagnostics' }]],
  use: { baseURL: BASE_URL },
  projects: [
    { name: 'webkit', use: { ...devices['iPhone 13'], permissions: [] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: process.env.CI ? 'npm run start' : 'npm run build && npm run start',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
