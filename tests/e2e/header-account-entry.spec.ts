import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * WHERE THE WAY IN SITS (UI audit 2026-10-13, batch E).
 *
 * At 1100px and wider, Sign in sits at the top right of the header: the last
 * thing on the right, on every page. Signed in, the same place holds the
 * account entry (Your runs, Sign out). Under 1100px nothing moves: the narrow
 * rail carries the entry at its foot from 760px, and under 760px the drawer
 * behind the menu button does.
 *
 * ONE ENTRY, NEVER TWO. The shell renders the entry in three places and shows
 * one of them at a time, so every width here is held to exactly one that is
 * drawn and can take focus, and to the other copies being `display: none`
 * (out of the tab order and out of the accessibility tree), not merely moved
 * off screen.
 *
 * THE LINE IS 1100, EXACTLY. 1099 and 1100 are both measured, and the header is
 * the same height on both sides of it.
 *
 * WHAT THE HEADER GIVES UP FOR IT. On the replay the bar already carried the
 * run telemetry, the outcome and the mode chip, and at 1100 in the fallback
 * font it had 140px left. So from 1100 up the replay's bar drops the
 * "SENTINEL FIELDS" tag (Batch G then removed it from every page), the chip sits to the
 * left of the entry, and nothing in the bar is drawn over anything else: that
 * last part is measured here, at 1100 in the fallback font, the worst case.
 *
 * CI's ordinary build has no auth backend, so the entry is in its PREVIEW state
 * there (see tests/e2e/account-entry.spec.ts); a build with one shows the plain
 * signed-out link. Each test asks the build which. The SIGNED-IN entry needs a
 * session, which the ordinary job has none of: its place and its fit are
 * measured on the header-states fixture, which draws the real `StatusBar` over
 * an invented address, and it is walked for real in `authenticated.spec.ts`.
 *
 * No exact sizes: order, containment, floors and a small tolerance.
 */

const FIXTURES_BUILT = process.env.E2E_FIXTURES === '1';
const NO_FIXTURES =
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this state needs is not built.';

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

type Font = 'loaded font' | 'fallback font';

/** Web fonts landed (or failed), and two frames for layout to follow. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function open(page: Page, path: string, font: Font = 'loaded font') {
  await suppressBootSplash(page);
  if (font === 'fallback font') {
    await page.context().route(/\.woff2?(\?|$)/, (route) => route.abort());
  }
  await page.goto(path);
  await settle(page);
}

const PAGES = [
  { name: 'Home', path: '/', chip: false },
  { name: 'Connect', path: '/connect', chip: false },
  { name: 'the sample replay', path: '/runs/sample', chip: true },
  { name: 'the sample report', path: '/findings/sample', chip: true },
  { name: 'Leaderboard', path: '/leaderboard', chip: false },
  { name: 'Threat model', path: '/threats', chip: false },
] as const;

/**
 * Everything the tests below need to know about the entry and the header,
 * measured in one pass so nothing moves between readings.
 */
const measure = (page: Page) =>
  page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const shown = (el: Element) => el.checkVisibility({ visibilityProperty: true });
    const where = (el: Element) =>
      el.closest('#mobile-deck')
        ? 'drawer'
        : el.closest('nav[aria-label="Command deck"]')
          ? 'rail'
          : el.closest('header')
            ? 'header'
            : 'elsewhere';
    const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]';
    const canFocus = (el: Element) => shown(el) && (el as HTMLElement).tabIndex >= 0;
    const name = (el: Element) =>
      el.getAttribute('aria-label') ?? (el.textContent ?? '').replace(/\s+/g, ' ').trim();

    const header = document.querySelector('header');
    const entries = [...document.querySelectorAll('[data-testid="account-entry"]')].map((el) => ({
      where: where(el),
      shown: shown(el),
      // No box at all: `display: none` on it or on something it sits in (the
      // rail under 760px, a closed popover). Not merely moved or made invisible.
      boxes: el.getClientRects().length,
      controls: [...el.querySelectorAll('a[href], button')].filter(canFocus).map(name),
    }));
    // Every control in the page that is a way in or a way out, wherever it is.
    const accountControls = [...document.querySelectorAll('a[href], button')]
      .filter((el) => el.closest('[data-testid="account-entry"]') && canFocus(el))
      .map((el) => ({ name: name(el), where: where(el), box: box(el) }));

    if (!header) return { entries, accountControls, header: null };

    const style = getComputedStyle(header);
    const probe = document.createElement('div');
    probe.style.height = 'var(--header-h)';
    document.body.append(probe);
    const set = probe.getBoundingClientRect().height;
    probe.remove();
    // What can take focus in the bar itself. The drawer's markup sits inside
    // the header element and is a closed popover, so `shown` leaves it out.
    const inBar = [...header.querySelectorAll(FOCUSABLE)]
      .filter(canFocus)
      .map((el) => ({ name: name(el), box: box(el) }));
    const word = [...header.querySelectorAll('span')]
      .filter((n) => /^(SAMPLE|LIVE)$/.test(n.textContent ?? ''))
      .pop();
    const chip = word?.parentElement ?? null;
    // The things drawn along the bar, left to right: what must not collide.
    // Each is a leaf of the row (a child of the header or of the bar inside
    // it) that is drawn and has a width; the bar itself, the pulse laid along
    // its edge and the empty spacers are not things to collide with.
    const bar = header.querySelector(':scope > div.relative');
    const drawn = [...header.children, ...(bar ? bar.children : [])]
      .filter((el) => el !== bar && shown(el) && !el.matches('[data-header-pulse]'))
      .filter((el) => (el.textContent ?? '').trim() !== '' || el.querySelector('svg'))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({ what: name(el).slice(0, 28), box: box(el) }))
      .sort((a, b) => a.box.left - b.box.left);
    const telemetry = [...header.querySelectorAll('div')].find((el) =>
      /^RUN\s/.test(el.textContent ?? ''),
    );
    return {
      entries,
      accountControls,
      header: {
        box: box(header),
        set,
        padRight: parseFloat(style.paddingRight),
        inBar,
        chip: chip ? box(chip) : null,
        drawn,
        telemetryWidth:
          telemetry && shown(telemetry) ? telemetry.getBoundingClientRect().width : null,
        tag: [...header.querySelectorAll('div')].some(
          (el) => shown(el) && (el.textContent ?? '').trim() === 'SENTINEL FIELDS',
        ),
      },
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

type Measured = Awaited<ReturnType<typeof measure>>;

/** Exactly one entry is drawn, in `place`; every other copy is `display: none`. */
function expectOneEntry(m: Measured, place: 'header' | 'rail' | 'drawer' | 'none') {
  const shown = m.entries.filter((entry) => entry.shown);
  expect(
    shown.map((entry) => entry.where),
    'the entries that are drawn',
  ).toEqual(place === 'none' ? [] : [place]);
  // A copy that is not drawn must be gone, not parked: `display: none`, so it
  // takes no focus and is not read out.
  for (const entry of m.entries.filter((e) => !e.shown)) {
    expect(entry.boxes, `the ${entry.where} copy has no box`).toBe(0);
    expect(entry.controls, `the ${entry.where} copy takes no focus`).toEqual([]);
  }
  expect(
    [...new Set(m.accountControls.map((control) => control.where))],
    'where the controls that can take focus are',
  ).toEqual(place === 'none' ? [] : [place]);
}

/** The entry is the last thing on the right of the header, inside its one row. */
function expectTopRight(m: Measured, lastName: string | RegExp) {
  const header = m.header!;
  const controls = m.accountControls;
  expect(controls.length, 'account controls in the header').toBeGreaterThan(0);
  const last = controls.reduce((a, b) => (a.box.right >= b.box.right ? a : b));
  if (typeof lastName === 'string') expect(last.name).toBe(lastName);
  else expect(last.name).toMatch(lastName);

  // Nothing that can take focus in the bar is further right.
  for (const other of header.inBar) {
    expect(other.box.right, `"${other.name}" is not right of the entry`).toBeLessThanOrEqual(
      last.box.right + 0.5,
    );
  }
  // Its right edge is the header's content edge: inside the header, and no
  // further in than the header's own right padding.
  expect(last.box.right, 'inside the header').toBeLessThanOrEqual(header.box.right + 0.5);
  expect(last.box.right, 'at the right end, one padding in at most').toBeGreaterThanOrEqual(
    header.box.right - header.padRight - 1,
  );
  // On the header's row, and the header is still its set height.
  for (const control of controls) {
    expect(control.box.top, `"${control.name}" starts inside the header`).toBeGreaterThanOrEqual(
      header.box.top - 0.5,
    );
    expect(control.box.bottom, `"${control.name}" ends inside the header`).toBeLessThanOrEqual(
      header.box.top + header.set + 0.5,
    );
    expect(control.box.right - control.box.left, `"${control.name}" width`).toBeGreaterThanOrEqual(
      43.5,
    );
    expect(control.box.bottom - control.box.top, `"${control.name}" height`).toBeGreaterThanOrEqual(
      43.5,
    );
  }
  expect(
    Math.abs(header.box.bottom - header.box.top - header.set),
    'the header is its set height',
  ).toBeLessThanOrEqual(0.5);
  // The chip, where there is one, sits to the left of the entry.
  if (header.chip) {
    const first = controls.reduce((a, b) => (a.box.left <= b.box.left ? a : b));
    expect(header.chip.right, 'the chip is left of the entry').toBeLessThanOrEqual(
      first.box.left + 0.5,
    );
  }
  // Nothing drawn along the bar runs into its neighbour.
  for (let i = 1; i < header.drawn.length; i += 1) {
    const before = header.drawn[i - 1]!;
    const after = header.drawn[i]!;
    expect(
      before.box.right,
      `"${before.what}" does not run into "${after.what}"`,
    ).toBeLessThanOrEqual(after.box.left + 0.5);
  }
  expect(m.overflow, 'no sideways scroll').toBeLessThanOrEqual(0);
}

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Desktop widths: the WebKit project is a phone.');
});

for (const width of [1100, 1280, 1440]) {
  for (const font of ['loaded font', 'fallback font'] as const) {
    test.describe(`${width}px, ${font}: the header`, () => {
      test.use({ viewport: { width, height: 900 } });

      for (const screen of PAGES) {
        test(`${screen.name}: Sign in is the last thing on the right of the header`, async ({
          page,
          request,
        }) => {
          const { name, preview } = await entryOnThisBuild(request);
          await open(page, screen.path, font);
          const m = await measure(page);

          expectOneEntry(m, 'header');
          expect(m.accountControls.map((control) => control.name)).toEqual([name]);
          expectTopRight(m, name);
          expect(Boolean(m.header!.chip), 'a mode chip on a run screen only').toBe(screen.chip);

          const banner = page.getByRole('banner');
          const link = banner.getByRole('link', { name, exact: true });
          await expect(link).toBeVisible();
          await expect(link).toHaveAttribute(
            'href',
            `/sign-in?next=${encodeURIComponent(screen.path)}`,
          );
          await expect(
            banner.getByTestId('account-preview-tag').filter({ visible: true }),
          ).toHaveCount(preview ? 1 : 0);
          await expect(banner.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
          // One link by that name in the whole page: the rail's is gone.
          await expect(page.getByRole('link', { name, exact: true })).toHaveCount(1);
        });
      }
    });
  }
}

test.describe('1100px: the bar of the replay has room', () => {
  test.use({ viewport: { width: 1100, height: 900 } });

  test('the run telemetry is not squeezed out, and the tag gives way to it', async ({ page }) => {
    await open(page, '/runs/sample', 'fallback font');
    const replay = (await measure(page)).header!;
    // G option B (owner ruling 2026-10-14): RUN, TARGET and DETECTOR left the
    // bar, where they were cut short, for the replay's own header under the
    // title. This read that the bar keeps a readable stretch of them.
    expect(replay.telemetryWidth, 'no run telemetry in the bar').toBeNull();
    await expect(page.locator('[data-replay-telemetry]')).toBeVisible();
    expect(replay.tag, 'SENTINEL FIELDS on the replay at 1100').toBe(false);

    // Batch G (2026-10-13, the owner's instruction): the tag is gone from every
    // page, not only the replay. This read `toBe(true)`, "every other page
    // keeps the tag".
    await page.goto('/findings/sample');
    await settle(page);
    expect((await measure(page)).header!.tag, 'SENTINEL FIELDS on the report').toBe(false);
  });
});

test.describe('the keyboard', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('reaches Sign in once, after the home link, and it wears the shared ring', async ({
    page,
    request,
  }) => {
    const { name } = await entryOnThisBuild(request);
    await open(page, '/leaderboard');

    const readRing = () =>
      page.evaluate(async () => {
        const el = document.activeElement as HTMLElement;
        // The control eases its colours, the ring's among them: read it at rest.
        await Promise.all(el.getAnimations().map((animation) => animation.finished));
        const style = getComputedStyle(el);
        const probe = document.createElement('div');
        probe.style.cssText =
          'outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: var(--focus-ring-offset)';
        document.body.append(probe);
        const shared = getComputedStyle(probe);
        const out = {
          name: el.getAttribute('aria-label'),
          inHeader: el.closest('header') !== null,
          style: style.outlineStyle,
          width: style.outlineWidth,
          color: style.outlineColor,
          offset: style.outlineOffset,
          shared: {
            width: shared.outlineWidth,
            color: shared.outlineColor,
            offset: shared.outlineOffset,
          },
        };
        probe.remove();
        return out;
      });

    // Walk the whole page by Tab, once round.
    const stops: string[] = [];
    let ring: Awaited<ReturnType<typeof readRing>> | null = null;
    for (let i = 0; i < 120; i += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return el.getAttribute('aria-label') ?? (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      });
      if (stop === null || (stops.length > 3 && stop === stops[0])) break;
      stops.push(stop);
      // The ring, read while the keyboard is on it.
      if (stop === name && ring === null) ring = await readRing();
    }
    expect(
      stops.filter((stop) => stop === name),
      'tab stops named for sign-in',
    ).toHaveLength(1);
    expect(stops.indexOf('MCProof home')).toBeGreaterThanOrEqual(0);
    expect(stops.indexOf(name), 'after the home link').toBeGreaterThan(
      stops.indexOf('MCProof home'),
    );
    if (ring === null) throw new Error('the keyboard never reached the entry');
    expect(ring.name).toBe(name);
    expect(ring.inHeader).toBe(true);
    expect(ring.style).toBe('solid');
    expect({ width: ring.width, color: ring.color, offset: ring.offset }).toEqual(ring.shared);
    expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(2);
  });

  test('takes you to sign-in and back to the page you were on', async ({ page, request }) => {
    const { name } = await entryOnThisBuild(request);
    await open(page, '/leaderboard');
    await page.getByRole('banner').getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fleaderboard$/);
  });

  test('follows a client navigation: the return path is the page you are on now', async ({
    page,
    request,
  }) => {
    const { name } = await entryOnThisBuild(request);
    await open(page, '/');
    await page
      .getByRole('navigation', { name: 'Command deck' })
      .getByRole('link', { name: /^Threat Model/ })
      .click();
    await expect(page).toHaveURL(/\/threats$/);
    await expect(page.getByRole('banner').getByRole('link', { name, exact: true })).toHaveAttribute(
      'href',
      '/sign-in?next=%2Fthreats',
    );
  });
});

// ── Under 1100px: where it has always been ───────────────────────────────────

for (const width of [1099, 1024, 768]) {
  test.describe(`${width}px: the narrow rail, unchanged`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const screen of PAGES.filter((p) => p.path === '/' || p.chip)) {
      test(`${screen.name}: the entry is the last item of the rail, and the header draws none`, async ({
        page,
        request,
      }) => {
        const { name } = await entryOnThisBuild(request);
        await open(page, screen.path);
        const m = await measure(page);

        expectOneEntry(m, 'rail');
        expect(m.accountControls.map((control) => control.name)).toEqual([name]);
        const rail = page.getByRole('navigation', { name: 'Command deck' });
        await expect(rail.getByRole('link', { name, exact: true })).toBeVisible();
        expect(
          await rail.evaluate(
            (nav) => nav.lastElementChild?.getAttribute('data-testid') === 'account-entry',
          ),
          'the last thing in the rail',
        ).toBe(true);
        // Nothing in the bar is a way in or out, and the bar holds one link
        // (home) and no button.
        expect(m.header!.inBar.map((control) => control.name)).toEqual(['MCProof home']);
        // The narrow rail: the short word sits under its icon, inside the rail.
        const stacked = await rail.getByRole('link', { name, exact: true }).evaluate((link) => {
          const icon = link.querySelector('svg')!.getBoundingClientRect();
          const word = link.querySelector('[data-rail-label]')!.getBoundingClientRect();
          const nav = link.closest('nav')!.getBoundingClientRect();
          return {
            under: word.top >= icon.bottom - 0.5,
            inside: word.left >= nav.left - 0.5 && word.right <= nav.right + 0.5,
          };
        });
        expect(stacked, `the rail at ${width}px`).toEqual({ under: true, inside: true });
        expect(m.overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}

for (const width of [390, 360, 320]) {
  test.describe(`${width}px: the drawer, unchanged`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('no entry is drawn until the menu is opened, then exactly one, in the drawer', async ({
      page,
      request,
    }) => {
      const { name } = await entryOnThisBuild(request);
      await open(page, '/runs/sample');
      expectOneEntry(await measure(page), 'none');

      await page.getByRole('button', { name: 'Open command deck' }).click();
      const drawer = page.locator('#mobile-deck');
      await expect(drawer.getByRole('link', { name, exact: true })).toBeVisible();
      const m = await measure(page);
      expectOneEntry(m, 'drawer');
      expect(m.accountControls.map((control) => control.name)).toEqual([name]);
      await expect(page.getByRole('link', { name, exact: true })).toHaveCount(1);
    });
  });
}

// ── The line itself ──────────────────────────────────────────────────────────

test('1099 and 1100: the entry changes place and the header keeps its height', async ({
  page,
  request,
}) => {
  const { name } = await entryOnThisBuild(request);
  await page.setViewportSize({ width: 1099, height: 900 });
  await open(page, '/runs/sample', 'fallback font');
  const below = await measure(page);
  expectOneEntry(below, 'rail');

  await page.setViewportSize({ width: 1100, height: 900 });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const above = await measure(page);
  expectOneEntry(above, 'header');
  expectTopRight(above, name);

  const height = (m: Measured) => m.header!.box.bottom - m.header!.box.top;
  expect(Math.abs(height(above) - height(below)), 'same header height').toBeLessThanOrEqual(0.5);
  expect(Math.abs(height(above) - above.header!.set)).toBeLessThanOrEqual(0.5);
});

// ── Enlarged text ────────────────────────────────────────────────────────────

/**
 * WITH THE TEXT DOUBLED THE ENTRY IS NOT PUSHED OFF THE SCREEN (WCAG 1.4.4).
 * The header may grow and the entry may drop to a row of its own; what it may
 * not do is make the page scroll sideways or leave the screen. Both ways of
 * doubling text that tests/e2e/large-text-wraps.spec.ts uses on a phone, here
 * at the two desktop widths where the bar is fullest, in the fallback font.
 */
for (const width of [1100, 1280]) {
  for (const mode of ['root 200%', 'doubled in place'] as const) {
    test.describe(`${width}px, text at ${mode}`, () => {
      test.use({ viewport: { width, height: 900 } });

      test('the entry stays whole and on the screen, and the page does not scroll sideways', async ({
        page,
        request,
      }) => {
        const { name } = await entryOnThisBuild(request);
        for (const screen of PAGES.filter((p) => p.path === '/' || p.chip)) {
          await test.step(screen.name, async () => {
            await open(page, screen.path, 'fallback font');
            if (mode === 'root 200%') {
              await page.evaluate(() => {
                document.documentElement.style.fontSize = '200%';
              });
            } else {
              await page.evaluate(() => {
                const els = [...document.body.querySelectorAll('*')].filter(
                  (el) => !(el instanceof SVGElement),
                ) as HTMLElement[];
                const sizes = els.map((el) => parseFloat(getComputedStyle(el).fontSize));
                els.forEach((el, i) =>
                  el.style.setProperty('font-size', `${sizes[i]! * 2}px`, 'important'),
                );
              });
            }
            await settle(page);

            const m = await measure(page);
            expectOneEntry(m, 'header');
            const link = m.accountControls.find((control) => control.name === name)!;
            expect.soft(m.overflow, `${screen.name}: sideways scroll`).toBeLessThanOrEqual(1);
            expect
              .soft(link.box.left, `${screen.name}: starts on the screen`)
              .toBeGreaterThan(-0.5);
            expect
              .soft(link.box.right, `${screen.name}: ends on the screen`)
              .toBeLessThanOrEqual(width + 1);
            expect
              .soft(link.box.bottom - link.box.top, `${screen.name}: target height`)
              .toBeGreaterThanOrEqual(43.5);
            // Inside the header, however tall the header has grown.
            expect
              .soft(link.box.bottom, `${screen.name}: inside the header`)
              .toBeLessThanOrEqual(m.header!.box.bottom + 0.5);
          });
        }
      });
    });
  }
}

// ── Signed in (the fixture) ──────────────────────────────────────────────────

const ADDRESS = 'someone.with.a.long.address@example.com';

for (const width of [1100, 1280]) {
  test.describe(`${width}px, signed in`, () => {
    test.skip(!FIXTURES_BUILT, NO_FIXTURES);
    test.use({ viewport: { width, height: 900 } });

    for (const [what, query, chip] of [
      ['over a live run', 'mode=live', true],
      ['on a page with no run', 'mode=none', false],
    ] as const) {
      test(`${what}: Your runs and Sign out, in the same place, and no Sign in`, async ({
        page,
      }) => {
        await open(
          page,
          `/e2e/header-states?${query}&account=${encodeURIComponent(ADDRESS)}`,
          'fallback font',
        );
        const m = await measure(page);

        expectOneEntry(m, 'header');
        expect(m.accountControls.map((control) => control.name)).toEqual([
          `Your runs, signed in as ${ADDRESS}`,
          'Sign out',
        ]);
        expectTopRight(m, 'Sign out');
        expect(Boolean(m.header!.chip)).toBe(chip);
        const banner = page.getByRole('banner');
        await expect(banner.getByRole('link', { name: /^sign in/i })).toHaveCount(0);
        await expect(
          banner.getByRole('link', { name: `Your runs, signed in as ${ADDRESS}` }),
        ).toHaveAttribute('href', '/account');
        // Who is signed in is written out wherever the bar is not full of a
        // run's telemetry; over a run it is in the link's name and its tooltip.
        await expect(banner.getByText(ADDRESS).filter({ visible: true })).toHaveCount(chip ? 0 : 1);
        await expect(
          banner.getByRole('link', { name: `Your runs, signed in as ${ADDRESS}` }),
        ).toHaveAttribute('title', `Your runs, signed in as ${ADDRESS}`);
      });
    }
  });
}

test.describe('1024px, signed in', () => {
  test.skip(!FIXTURES_BUILT, NO_FIXTURES);
  test.use({ viewport: { width: 1024, height: 900 } });

  test('the header draws no account control under 1100px', async ({ page }) => {
    await open(page, `/e2e/header-states?mode=live&account=${encodeURIComponent(ADDRESS)}`);
    const m = await measure(page);
    // The fixture draws the bar alone (no rail), so nothing is drawn at all.
    expectOneEntry(m, 'none');
    expect(m.header!.inBar.map((control) => control.name)).toEqual(['MCProof home']);
  });
});
