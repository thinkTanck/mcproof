import { test, expect, type APIRequestContext } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE SHELL'S ACCOUNT ENTRY, AS THIS BUILD HAS IT (sweep 2026-10-07, X2).
 *
 * CI's ordinary build has no auth backend, so the entry is in its PREVIEW state
 * there: a way to the sign-in page that says plainly sign-in is not set up. A
 * developer's build usually HAS one (`.env.local`), and then the same entry is
 * the plain signed-out link. So each test first asks the build which it is, from
 * the sign-in page, and holds the entry to that. In CI it must be PREVIEW, so
 * that state can never go unexercised. The signed-in state needs a real session
 * and is walked in `authenticated.spec.ts`, in the job that has one.
 *
 * The entry sits at the bottom of the rail and of the mobile drawer. The header
 * is deliberately untouched; `header-fallback-font.spec.ts` still holds the mode
 * chip inside it at 320.
 */
const PREVIEW_NAME = 'Sign in. Preview: sign-in is not set up on this build.';

/** What the entry must be on THIS build: PREVIEW without an auth backend. */
async function entryOnThisBuild(request: APIRequestContext) {
  const signIn = await (await request.get('/sign-in')).text();
  const preview = signIn.includes('Sign-in wiring ships with the hosted release');
  if (process.env.CI) {
    expect(preview, 'the CI build has no auth backend, so the entry is PREVIEW').toBe(true);
  }
  return { preview, name: preview ? PREVIEW_NAME : 'Sign in' };
}

test.beforeEach(async ({ page }) => {
  await suppressBootSplash(page);
});

test.describe('1280: the rail', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('carries the entry, marked PREVIEW on a build with no auth, linking to sign-in and back to this page', async ({
    page,
    request,
  }) => {
    const { name, preview } = await entryOnThisBuild(request);
    await page.goto('/leaderboard');
    const rail = page.getByRole('navigation', { name: 'Command deck' });
    const link = rail.getByRole('link', { name, exact: true });

    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/sign-in?next=%2Fleaderboard');
    await expect(rail.getByTestId('account-entry').getByText('PREVIEW')).toHaveCount(
      preview ? 1 : 0,
    );
    // Signed out either way: nothing claims an account.
    await expect(rail.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await link.click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fleaderboard$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Continue to MCProof.' }),
    ).toBeVisible();
  });

  test('follows a client navigation: the return path is the page you are on now', async ({
    page,
    request,
  }) => {
    const { name } = await entryOnThisBuild(request);
    await page.goto('/');
    const rail = page.getByRole('navigation', { name: 'Command deck' });
    await rail.getByRole('link', { name: /^Threat Model/ }).click();
    await expect(page).toHaveURL(/\/threats$/);

    await expect(rail.getByRole('link', { name, exact: true })).toHaveAttribute(
      'href',
      '/sign-in?next=%2Fthreats',
    );
  });

  test('the header carries no account control', async ({ page }) => {
    await page.goto('/');

    // The drawer's markup sits inside the header element, as a closed popover:
    // it is not part of the bar. Nothing account-related is VISIBLE in the bar.
    await expect(page.getByRole('banner').getByRole('link', { name: /sign in/i })).toHaveCount(0);
    await expect(
      page.getByRole('banner').getByTestId('account-entry').filter({ visible: true }),
    ).toHaveCount(0);
  });
});

test.describe('320: the drawer', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('carries the same entry, full size, with no sideways scroll', async ({ page, request }) => {
    const { name, preview } = await entryOnThisBuild(request);
    await page.goto('/runs/sample');
    await page.getByRole('button', { name: 'Open command deck' }).click();
    const drawer = page.locator('#mobile-deck');
    const link = drawer.getByRole('link', { name, exact: true });

    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/sign-in?next=%2Fruns%2Fsample');
    await expect(drawer.getByTestId('account-entry').getByText('PREVIEW')).toHaveCount(
      preview ? 1 : 0,
    );
    const box = (await link.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    // Wholly inside the drawer, and the drawer inside the screen.
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect(box.y + box.height).toBeLessThanOrEqual(568);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    // The mode chip is still wholly on screen: the header gave up nothing.
    await expect(page.getByRole('banner').getByText('SAMPLE', { exact: true })).toBeInViewport({
      ratio: 1,
    });
  });

  test('is reachable by keyboard from the menu button', async ({ page, request }) => {
    const { name } = await entryOnThisBuild(request);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open command deck' }).focus();
    await page.keyboard.press('Enter');

    const names: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      names.push(
        await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''),
      );
      if (names.at(-1) === name) break;
    }
    expect(names).toContain(name);
  });
});

/**
 * A PER-USER LABEL MUST NEVER BE SERVED FROM A SHARED CACHE. The shell prints the
 * signed-in address, so every page it wraps has to tell caches the response is
 * for this visitor only.
 */
for (const path of [
  '/',
  '/connect',
  '/leaderboard',
  '/threats',
  '/runs/sample',
  '/findings/sample',
]) {
  test(`${path} is not cacheable by a shared cache`, async ({ request }) => {
    const response = await request.get(path);
    const cacheControl = response.headers()['cache-control'] ?? '';

    expect(response.status()).toBe(200);
    expect(cacheControl, `Cache-Control for ${path}: "${cacheControl}"`).toMatch(
      /\b(private|no-store)\b/,
    );
    expect(cacheControl).not.toMatch(/\bpublic\b|s-maxage=[1-9]/);
  });
}
