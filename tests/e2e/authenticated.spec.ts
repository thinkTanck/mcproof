import { test, expect } from '@playwright/test';
import { expectNoWcagViolations, suppressBootSplash } from './support/screen';
import {
  AUTH_STACK_CONFIGURED,
  AUTH_STACK_REQUIRED,
  completeTheSignInForm,
} from './support/session';

/**
 * THE SIGNED-IN SCREENS, SCANNED.
 *
 * `tests/e2e/screens.spec.ts` states the gap this closes: the signed-in live
 * console (issued endpoint, masked token, task goal, connection panel) and
 * `/account` were never scanned, because reaching them needs a real session. So
 * this spec makes a real session, the way `./support/session.ts` explains, and
 * scans them with the same axe configuration every other screen gets.
 *
 * ── IT NEVER PASSES QUIETLY ──
 *
 * With no local Supabase stack it SKIPS, with the reason in the annotation, so a
 * developer running `npm run test:e2e` sees "not covered" rather than a green
 * tick over nothing. In the CI job that owns this coverage `E2E_REQUIRE_AUTH=1`
 * is set, and then a missing stack is a FAILURE instead of a skip. The job
 * cannot report success without having actually scanned these two screens.
 */
test.describe('signed-in screens', () => {
  /**
   * ONE RETRY, not the suite's two. Every attempt sends a real email through the
   * local GoTrue, which caps outgoing mail per hour; three attempts would spend
   * the cap and turn a flake into a cascade. One retry absorbs a transient
   * navigation without ever reaching the limit.
   */
  test.describe.configure({ retries: 1 });

  test.skip(
    !AUTH_STACK_CONFIGURED && !AUTH_STACK_REQUIRED,
    'NOT COVERED: no local Supabase stack (E2E_AUTH_MAIL_URL unset), so the signed-in console and /account were not scanned.',
  );

  test.beforeEach(async ({ page }) => {
    // Fail closed. In the job that requires this coverage, an absent stack must
    // never look like a pass.
    expect(
      AUTH_STACK_CONFIGURED,
      'E2E_REQUIRE_AUTH=1 but E2E_AUTH_MAIL_URL is unset: the signed-in scan has nothing to sign in to',
    ).toBe(true);
    await suppressBootSplash(page);
  });

  test('the account page and the signed-in live console render and have no WCAG A/AA violations', async ({
    page,
  }) => {
    // ── BEFORE SIGN-IN: the shell offers a way in, and it is not a preview ──
    // This build has a real auth backend, so the entry is the plain one.
    // At 1280 the entry is at the top right of the header (from 1100px up).
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/connect');
    const bar = page.getByRole('banner');
    const entry = bar.getByTestId('account-entry').filter({ visible: true });
    await expect(bar.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
      'href',
      '/sign-in?next=%2Fconnect',
    );
    await expect(entry).toHaveCount(1);
    await expect(entry.getByText('PREVIEW')).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Sign out' })).toHaveCount(0);

    // ── THE LIVE GATE SENDS YOU TO SIGN IN, AND SIGN-IN BRINGS YOU BACK ──
    // It used to link to a bare /sign-in, which lands on /account: someone who
    // signed in to run live had to find their own way back to Connect.
    await page.getByRole('button', { name: /^LIVE/ }).click();
    await page
      .getByRole('main')
      .getByRole('link', { name: /^sign in$/i })
      .click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fconnect$/);
    // ONE sign-in for the whole test: the local stack caps outgoing mail.
    const address = await completeTheSignInForm(page, '/connect');
    await expect(page).toHaveURL(/\/connect$/);

    // ── SIGNED IN: the header says who, and offers the way out ──
    await expect(entry).toHaveCount(1);
    await expect(entry.getByText('SIGNED IN')).toBeVisible();
    await expect(entry.getByText(address)).toBeVisible();
    await expect(
      bar.getByRole('link', { name: `Your runs, signed in as ${address}` }),
    ).toHaveAttribute('href', '/account');
    await expect(bar.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(bar.getByRole('link', { name: /^sign in/i })).toHaveCount(0);
    // And the rail, which carries the entry below 1100px, draws none here.
    const rail = page.getByRole('navigation', { name: 'Command deck' });
    await expect(rail.getByTestId('account-entry').filter({ visible: true })).toHaveCount(0);

    // ── THE SAME ENTRY ON A PHONE, IN THE DRAWER ──
    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole('button', { name: 'Open command deck' }).click();
    const drawer = page.locator('#mobile-deck');
    await expect(drawer.getByTestId('account-entry').getByText(address)).toBeVisible();
    for (const control of [
      drawer.getByRole('link', { name: `Your runs, signed in as ${address}` }),
      drawer.getByRole('button', { name: 'Sign out' }),
    ]) {
      await expect(control).toBeVisible();
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 900 });

    // ── /account ──
    await bar.getByRole('link', { name: `Your runs, signed in as ${address}` }).click();
    await expect(page).toHaveURL(/\/account$/);
    // Proof the session is real and owner-scoped: the page shows the address we
    // just signed in as, which only a resolved session can supply.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // In the page itself: the shell now prints the address too (header and drawer).
    await expect(page.getByRole('main').getByText(address)).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: /sign out/i })).toBeVisible();
    await expectNoWcagViolations(page);

    // ── /connect, live mode, SIGNED IN ──
    await page.goto('/connect');
    await page.getByRole('button', { name: /^LIVE/ }).click();

    // The gate is gone and the console is here. Asserted on the control that
    // starts a run rather than on a sentence (its label read ISSUE RUN ENDPOINT
    // until the UI and copy PR, 2026-10-15, and now reads START A RUN).
    await expect(page.getByRole('button', { name: /^start a run$/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /^sign in$/i })).toHaveCount(0);
    // The token discipline the screen claims: nothing on it takes typed input,
    // so no autofill store or password manager has a control to latch onto.
    // Scoped to the screen. The shell's Sign out is a form that posts a server
    // action, and React gives such a form hidden fields; they are not controls
    // anyone types into, and they are outside the console this claim is about.
    await expect(page.getByRole('main').locator('input')).toHaveCount(0);
    // And nowhere on the page, shell included, is there a field to type into.
    await expect(page.locator('input:not([type="hidden"]), textarea, select')).toHaveCount(0);

    // BOTH FRAMINGS ARE REACHABLE FROM THE SIGNED-IN CONSOLE, and the panel
    // describes the one that is actually about to be served: saying "the attack
    // surface" over a control run would be the only untrue sentence on it.
    // Bound to the CONSOLE's own sentence, not to the phrase alone: the setup
    // section above states tool parity in nearly the same words, so a short
    // match would find two elements and prove neither.
    await page.getByRole('radio', { name: /CONTROL RUN/ }).click();
    await expect(
      page.getByText(/We serve the tools for the attack type you picked, with no attack/i),
    ).toBeVisible();

    await expectNoWcagViolations(page);

    // ── SIGN OUT, FROM THE SHELL: back to the front door, session gone ──
    await bar.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(bar.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    await expect(bar.getByText(address).filter({ visible: true })).toHaveCount(0);
    // Not just a label: the session really is cleared.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
  });
});
