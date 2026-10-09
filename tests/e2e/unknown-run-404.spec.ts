import { test, expect } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * UNKNOWN RUN IDS ANSWER 404, AND KEEP THEIR OWN WORDS (sweep 2026-10-07, X3).
 *
 * `/runs/does-not-exist` and `/findings/does-not-exist` used to render their
 * empty state with HTTP 200. The status is the fix; the copy stays, inside the
 * shell, so a person who mistyped an id still gets the way forward.
 *
 * NOT COVERED HERE: a real live run opened by someone who may not see it. No
 * fixture stores a live run, so a browser cannot reach that case. It is held to
 * the same 404 in `tests/unit/app/unknown-run-404.test.tsx`.
 */
test.beforeEach(async ({ page }) => {
  await suppressBootSplash(page);
});

test('/runs/does-not-exist answers 404 with the replay empty state', async ({ page }) => {
  const response = await page.goto('/runs/does-not-exist');
  expect(response?.status()).toBe(404);

  await expect(page.getByRole('heading', { level: 1, name: 'No run to replay.' })).toBeVisible();
  await expect(page.getByRole('main').getByText('does-not-exist')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Play the sample run' })).toBeVisible();
  // Still inside the shell, with no run on show and so no mode chip.
  await expect(page.getByRole('navigation', { name: 'Command deck' })).toBeVisible();
  await expect(page.locator('header').getByText(/^(SAMPLE|LIVE)$/)).toHaveCount(0);
  // Next marks a 404 as not for indexing.
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
});

test('/findings/does-not-exist answers 404 with the report empty state', async ({ page }) => {
  const response = await page.goto('/findings/does-not-exist');
  expect(response?.status()).toBe(404);

  await expect(
    page.getByRole('heading', { level: 1, name: 'No report for run does-not-exist' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Command deck' })).toBeVisible();
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
});

test('two different unknown ids get the same status and the same title', async ({ page }) => {
  // One id that cannot be a run, one that is shaped like a row id. They take
  // different routes to the same answer, and the title is asserted with the
  // retrying matcher: for the uuid the client sets it, so a single read raced it.
  for (const id of ['does-not-exist', '00000000-0000-4000-8000-000000000000']) {
    const response = await page.goto(`/runs/${id}`);
    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle('Run not found · MCProof');
    await expect(page.getByRole('heading', { level: 1, name: 'No run to replay.' })).toBeVisible();
  }
});

test('a client-sent x-pathname header cannot change the id the 404 names', async ({ browser }) => {
  // The not-found page reads the path from `x-pathname`. The middleware sets
  // that header from the real URL, so one sent by the caller is discarded.
  const context = await browser.newContext({
    extraHTTPHeaders: { 'x-pathname': '/runs/chosen-by-the-caller' },
  });
  const page = await context.newPage();
  await suppressBootSplash(page);

  const response = await page.goto('/runs/does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('main').getByText('does-not-exist')).toBeVisible();
  await expect(page.getByText('chosen-by-the-caller')).toHaveCount(0);
  await context.close();
});

for (const path of ['/runs/sample', '/findings/sample', '/runs/asi10-goal-drift']) {
  test(`${path} still answers 200`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  });
}

/**
 * THE 404 IS IN THE HTML, NOT ONLY IN THE SCRIPT (review of PR #188).
 *
 * The tests above drive a browser, and a browser runs JavaScript. The first
 * version of this change passed them while the server sent an empty document:
 * `<html id="__next_error__">`, no body, the site's default title, and the
 * empty-state copy only inside the flight payload for the client to draw later.
 * A client that runs no script (a link preview, a crawler, a screen reader that
 * reads before hydration) got a blank page.
 *
 * So these fetch the RAW response with no browser at all and read the markup.
 */
const SITE_DEFAULT_TITLE = 'MCProof · Red-team your MCP agents';

const RAW: { path: string; h1: RegExp; title: string }[] = [
  {
    path: '/runs/does-not-exist',
    h1: /<h1[^>]*>No run to replay\./,
    title: 'Run not found · MCProof',
  },
  {
    path: '/findings/does-not-exist',
    h1: /<h1[^>]*>No report for run\s*(<!-- -->)?\s*<span[^>]*>does-not-exist<\/span>/,
    title: 'Report not found · MCProof',
  },
  // GREEN CONTROL: the root 404 has always been server-rendered. If this one
  // ever fails, the assertions are wrong, not the routes above.
  {
    path: '/no-such-route',
    h1: /<h1[^>]*>404 · route not found/,
    title: 'Not found · MCProof',
  },
];

for (const { path, h1, title } of RAW) {
  test(`${path}: the raw HTML, with no script run, is the rendered 404`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(404);

    const html = await response.text();
    // Rendered markup only: every script is removed first, so the copy inside a
    // flight payload cannot satisfy these.
    const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');

    expect(html, 'not the client-rendered error shell').not.toMatch(
      /<html[^>]*id="__next_error__"/,
    );
    expect(markup, 'the heading is in the rendered markup').toMatch(h1);
    expect(markup).toMatch(/<html[^>]*lang="en"/);

    const pageTitle = /<title>([^<]*)<\/title>/.exec(html)?.[1];
    expect(pageTitle, 'its own title, not the site default').not.toBe(SITE_DEFAULT_TITLE);
    expect(pageTitle).toBe(title);
    expect(html, 'a 404 is not for indexing').toMatch(/<meta name="robots" content="[^"]*noindex/);
  });
}

/**
 * KNOWN LIMITATION, tracked in issue #189.
 *
 * An id shaped like a row id has to be looked up, so it still goes through the
 * page, and the page answers with notFound(). Next 16.3.7 cannot server-render
 * that: the HTML render fails at the shell and the recovery render sends an
 * empty `<html id="__next_error__">`, leaving the not-found boundary to the
 * client (next/dist/server/app-render/app-render.js, getErrorRSCPayload). So
 * the status and noindex are asserted here and the BODY IS NOT. When #189 lands
 * (the lookup moves into the middleware), assert the body as the tests above do.
 */
for (const path of [
  '/runs/00000000-0000-4000-8000-000000000000',
  '/findings/00000000-0000-4000-8000-000000000000',
]) {
  test(`${path}: an unknown uuid-shaped id answers 404 and noindex`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
    expect(await response.text()).toMatch(/<meta name="robots" content="[^"]*noindex/);
  });
}

test('the not-found pages are not reachable as pages of their own', async ({ request }) => {
  // The middleware rewrites to these. Asked for directly they are still a 404.
  for (const path of ['/missing/run', '/missing/report']) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});
