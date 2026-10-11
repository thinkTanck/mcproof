import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright drives the top of the Test Pyramid: end-to-end tests on the critical
 * path (connect -> replay -> export fix report -> copy it), plus a render +
 * WCAG A/AA scan of every shipped screen. See `tests/e2e/`.
 */
/**
 * `next start` honours PORT, so the whole suite follows it. Default 3000 (what CI
 * uses); overridable so a second checkout can run the suite against its OWN build
 * instead of colliding with, or silently testing, a server already on 3000.
 */
const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

/** The only specs the WebKit project runs. Everything else is Chromium-only. */
const WEBKIT_SPECS =
  /(small-text-line-spacing|rail-visible-labels|drawer-closes-on-navigate)\.spec\.ts$/;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // The critical path copies a fix report to the clipboard; grant access so
    // `tests/e2e/critical-path.spec.ts` can read it back and assert what was
    // copied. Chromium honours these; the app never needs them at runtime.
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // WebKit is the engine on every iPhone, and small wrapped text is a phone
    // problem, so the text-spacing spec is measured there too, and so is the
    // phone drawer closing on navigation. ONLY those specs:
    // the rest of the suite stays Chromium-only, so CI time barely moves. The
    // specs set their own viewports; this supplies the touch, mobile and user-agent
    // half of a phone. WebKit rejects the clipboard permissions above, and the
    // spec copies nothing, so they are dropped here. The rail-labels spec runs
    // here too: touch is where a tooltip-only name fails (S4).
    // specs copy nothing, so they are dropped here.
    {
      name: 'webkit',
      testMatch: WEBKIT_SPECS,
      use: { ...devices['iPhone 13'], permissions: [] },
    },
  ],
  webServer: {
    // In CI the pipeline's Build step already produced `.next`, so just start the
    // server; locally, build first so `next start` has something to serve.
    command: process.env.CI ? 'npm run start' : 'npm run build && npm run start',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
