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
  /(small-text-line-spacing|phone-replay-layout|run-bar-short-screens|copy-failed-show-config|rail-visible-labels|drawer-closes-on-navigate|large-text-wraps|run-bar-clears-header|phone-run-bar|contrast-text-floor-focus|buttons-targets-nav-skip|words-and-meaning|readability-hierarchy|no-sideways-scroll|replay-rows-no-transition|security-headers)\.spec\.ts$/;

/**
 * The WebKit specs that put a style tag of their own into the page with
 * `page.addStyleTag` (a 12px root size, the WCAG 1.4.12 spacing override).
 *
 * The site sends a report-only content security policy whose `style-src` wants
 * a nonce. A test's style tag has none, so WebKit logs "[Report Only] Refused to
 * apply a stylesheet", and Playwright's WebKit turns that log line into a thrown
 * `addStyleTag` error although the style was applied. Chromium does not.
 *
 * Those style tags are the test's, not something the site loads, so the policy
 * is not widened for them. These specs run in a WebKit project of their own with
 * `bypassCSP`, and ONLY these: every other spec, in both engines, runs with the
 * policy as sent, and `security-headers.spec.ts` must never be listed here. A
 * new WebKit spec that calls `addStyleTag` goes on this list.
 */
const WEBKIT_SPECS_WITH_TEST_STYLES =
  /(small-text-line-spacing|contrast-text-floor-focus)\.spec\.ts$/;

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
    // WebKit is the engine on every iPhone, so the phone-specific specs listed in
    // WEBKIT_SPECS are measured there too. ONLY those specs: the rest of the suite
    // stays Chromium-only, so CI time barely moves. Each spec sets its own viewports;
    // this supplies the touch, mobile and user-agent half of a phone. WebKit rejects
    // the clipboard permissions above, so they are dropped here; a spec that needs
    // the clipboard refuses or skips it itself.
    {
      name: 'webkit',
      testMatch: WEBKIT_SPECS,
      testIgnore: WEBKIT_SPECS_WITH_TEST_STYLES,
      use: { ...devices['iPhone 13'], permissions: [] },
    },
    // The same phone, for the specs that inject a style tag. See the list above.
    {
      name: 'webkit-test-styles',
      testMatch: WEBKIT_SPECS_WITH_TEST_STYLES,
      use: { ...devices['iPhone 13'], permissions: [], bypassCSP: true },
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
