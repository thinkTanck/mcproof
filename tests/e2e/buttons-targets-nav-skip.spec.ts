import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';
import {
  installAudit,
  probeContrastOf,
  probePaintContrast,
  probeTargets,
  type MeasuredTarget,
} from './support/ui-audit';

/**
 * BUTTONS, TARGETS, STATES AND THE SKIP LINK (UI audit 2026-10-12, batch B;
 * WCAG 2.5.5, 2.5.8, 2.4.1, 1.4.11, 4.1.2).
 *
 * Measured in a real browser, at a phone width and a desk width:
 *
 *  1. "CONNECT YOUR AGENT" IS ONE OUTLINED BUTTON. Wherever that call to action
 *     is drawn it is the same control: no fill, a solid border on all four
 *     sides that is at least 3:1 against what is around it, a label at least
 *     4.5:1, no shadow, the same classes, the same words, the same place to go.
 *
 *  2. EVERY POINTER TARGET IS AT LEAST 44 BY 44. On every page and every state
 *     that needs no account. A control passes on its own box, or on a hit area
 *     of that size (sampled with `elementFromPoint`, so two hit areas that
 *     overlap fail). The exemptions are listed below, each with its reason.
 *
 *  3. THE ACTIVE NAV ITEM SAYS SO TWICE. `aria-current="page"` on exactly one
 *     item of the nav that is on screen, on no page that has no item, and a bar
 *     beside it that is at least 2px wide and 3:1, so the state is not carried
 *     by colour alone.
 *
 *  4. CONNECT HAS A SECOND SKIP LINK. "Skip to run controls" is the second tab
 *     stop, cannot be seen until the keyboard is on it, and moves the keyboard
 *     to the run bar when a run is open and to the block that starts a run
 *     when none is.
 *
 *  5. A LIST ROW THAT CAN BE CLICKED ANSWERS A POINTER, and only a pointer that
 *     can hover: every `:hover` rule in the stylesheet sits inside
 *     `@media (hover: hover)`, so a phone never keeps a stuck hover.
 *
 * WebKit runs all of it at the phone width, except the hover part, which
 * needs a pointer that hovers.
 *
 * No exact pixel sizes: the only numbers are the floors above.
 */

const FIXTURES_BUILT = process.env.E2E_FIXTURES === '1';
const TARGET_MIN = 44;
const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;
const INDICATOR_MIN_WIDTH = 2;

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

const WEBKIT_IS_A_PHONE = 'WebKit stands in for an iPhone: it is measured at the phone width.';
const NO_FIXTURES =
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this state needs is not built.';

/** Let web fonts land and every finite animation finish, so the page is at rest. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

async function open(page: Page, path: string) {
  await suppressBootSplash(page);
  await page.goto(path);
  await expect(page.locator('h1').first()).toBeVisible();
  await settle(page);
}

/** Issue a run on the Connect states fixture, as the other Connect specs do. */
async function issueRun(page: Page, state: 'waiting' | 'connected' | 'expired') {
  await open(page, `/e2e/connect-states?state=${state}`);
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /issue run endpoint/i }).click();
  await expect(page.locator('section[aria-labelledby="connect-state"]')).toBeVisible();
  await settle(page);
}

const visibleButton = (page: Page, name: string | RegExp) =>
  page
    .getByRole('button', { name, exact: typeof name === 'string' })
    .filter({ visible: true })
    .first();

// ── 1. The call to action ────────────────────────────────────────────────────

const CTA_PAGES: { name: string; path: string; fixture?: boolean }[] = [
  { name: 'Home', path: '/' },
  { name: 'Leaderboard, nothing measured', path: '/leaderboard' },
  {
    name: 'Replay of a discarded run',
    path: '/e2e/connect-states?state=run-discarded',
    fixture: true,
  },
  {
    name: 'Report of a discarded run',
    path: '/e2e/connect-states?state=report-discarded',
    fixture: true,
  },
];

const CTA = '[data-cta="connect-agent"]';

async function readCta(page: Page) {
  const link = page.locator('main').getByRole('link', { name: /^connect your agent/i });
  await expect(link, 'one "Connect your agent" on the page').toHaveCount(1);
  return link.evaluate((el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
    return {
      marker: el.getAttribute('data-cta'),
      href: el.getAttribute('href'),
      classes: el.className,
      words: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      name: el.getAttribute('aria-label') ?? '',
      borders: sides.map((side) => ({
        width: parseFloat(style[`border${side}Width`]),
        style: style[`border${side}Style`],
      })),
      shadow: style.boxShadow,
      width: rect.width,
      height: rect.height,
    };
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`"Connect your agent" at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const where of CTA_PAGES) {
      test(`${where.name}: an outlined button`, async ({ page, browserName }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        test.skip(Boolean(where.fixture) && !FIXTURES_BUILT, NO_FIXTURES);
        await open(page, where.path);
        await installAudit(page);

        const cta = await readCta(page);
        expect(cta.marker, 'the shared control, marked').toBe('connect-agent');
        expect(cta.href).toBe('/connect');
        for (const border of cta.borders) {
          expect(border.style, 'a border on every side').toBe('solid');
          expect(border.width, 'a border on every side').toBeGreaterThanOrEqual(1);
        }
        expect(cta.shadow, 'no glow and no shadow').toBe('none');
        expect(cta.width, 'target width').toBeGreaterThanOrEqual(TARGET_MIN);
        expect(cta.height, 'target height').toBeGreaterThanOrEqual(TARGET_MIN);

        const fill = await probePaintContrast(page, CTA, 'backgroundColor');
        expect(fill?.alpha, 'no fill: the background is transparent').toBe(0);
        const border = await probePaintContrast(page, CTA, 'borderTopColor');
        expect(border?.ratio ?? 0, 'border against what is around it').toBeGreaterThanOrEqual(
          NON_TEXT_MIN,
        );
        const label = await probeContrastOf(page, CTA);
        expect(label?.ratio ?? 0, 'label against what is under it').toBeGreaterThanOrEqual(
          TEXT_MIN,
        );
      });
    }

    test('the same control on every page it is drawn on', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      const seen: { where: string; classes: string; words: string; href: string | null }[] = [];
      for (const where of CTA_PAGES) {
        if (where.fixture && !FIXTURES_BUILT) continue;
        await open(page, where.path);
        const cta = await readCta(page);
        seen.push({ where: where.name, classes: cta.classes, words: cta.words, href: cta.href });
      }
      expect(seen.length, 'pages measured').toBeGreaterThan(1);
      const [first, ...rest] = seen;
      for (const other of rest) {
        expect({ ...other, where: '' }, `${other.where} against ${first!.where}`).toEqual({
          ...first!,
          where: '',
        });
      }
    });
  });
}

// ── 2. Targets ───────────────────────────────────────────────────────────────

interface Screen {
  name: string;
  fixture?: boolean;
  phoneOnly?: boolean;
  arrive: (page: Page) => Promise<void>;
}

const CLIENT_TABS = [
  'CLAUDE CODE',
  'GITHUB COPILOT / VS CODE',
  'CURSOR',
  'CODEX',
  'GEMINI CLI',
  'OTHER AGENT',
];

const SCREENS: Screen[] = [
  { name: 'Home', arrive: (page) => open(page, '/') },
  {
    name: 'Home, command deck drawer open',
    phoneOnly: true,
    arrive: async (page) => {
      await open(page, '/');
      await page.getByRole('button', { name: 'Open command deck' }).click();
      await settle(page);
    },
  },
  { name: 'Connect', arrive: (page) => open(page, '/connect') },
  {
    name: 'Connect, LIVE chosen',
    arrive: async (page) => {
      await open(page, '/connect');
      await page.getByRole('button', { name: /^LIVE/ }).click();
      await settle(page);
    },
  },
  {
    name: 'Connect, LIVE chosen, before a run is issued',
    fixture: true,
    arrive: async (page) => {
      await open(page, '/e2e/connect-states?state=waiting');
      await page.getByRole('button', { name: /^LIVE/ }).click();
      await settle(page);
    },
  },
  ...CLIENT_TABS.map((tab): Screen => ({
    name: `Connect, run issued, ${tab} tab`,
    fixture: true,
    arrive: async (page) => {
      await issueRun(page, 'waiting');
      await page
        .getByRole('group', { name: 'MCP client' })
        .getByRole('button', { name: new RegExp(`^${tab.replace(/[/]/g, '\\/')}$`) })
        .click();
      await settle(page);
    },
  })),
  {
    name: 'Connect, agent connected',
    fixture: true,
    arrive: (page) => issueRun(page, 'connected'),
  },
  {
    name: 'Connect, discard question open',
    fixture: true,
    arrive: async (page) => {
      await issueRun(page, 'connected');
      await visibleButton(page, 'DISCARD RUN').click();
      await expect(page.getByRole('button', { name: /keep running/i })).toBeVisible();
      await settle(page);
    },
  },
  {
    name: 'Connect, run discarded',
    fixture: true,
    arrive: async (page) => {
      await issueRun(page, 'connected');
      await visibleButton(page, 'DISCARD RUN').click();
      await page.getByRole('button', { name: 'DISCARD', exact: true }).click();
      await expect(page.getByText('RUN DISCARDED').first()).toBeVisible();
      await settle(page);
    },
  },
  {
    name: 'Connect, run finished',
    fixture: true,
    arrive: async (page) => {
      await issueRun(page, 'connected');
      await visibleButton(page, /end run and judge/i).click();
      await expect(page.getByRole('button', { name: /new run/i }).first()).toBeVisible();
      await settle(page);
    },
  },
  {
    name: 'Connect, run expired',
    fixture: true,
    arrive: (page) => issueRun(page, 'expired'),
  },
  { name: 'Report', arrive: (page) => open(page, '/findings/sample') },
  {
    name: 'Report, remediation withheld',
    arrive: (page) => open(page, '/findings/asi10-goal-drift'),
  },
  { name: 'Replay, paused at the first step', arrive: (page) => open(page, '/runs/sample') },
  {
    name: 'Replay, at the last step',
    arrive: async (page) => {
      await open(page, '/runs/sample');
      const next = page.getByRole('button', { name: 'Next step' }).filter({ visible: true });
      for (let i = 0; i < 40 && (await next.isEnabled()); i += 1) await next.click();
      await settle(page);
    },
  },
  {
    // The run whose transcript has the most one-line steps: a one-line row is
    // the shortest a step's button can be.
    name: 'Replay of a run with one-line steps, at the last step',
    arrive: async (page) => {
      await open(page, '/runs/asi06-run');
      const next = page.getByRole('button', { name: 'Next step' }).filter({ visible: true });
      for (let i = 0; i < 40 && (await next.isEnabled()); i += 1) await next.click();
      // The last line is typed out a character at a time: wait for the run to
      // read as complete before measuring its rows.
      await page.waitForTimeout(1500);
      await settle(page);
    },
  },
  {
    name: 'Replay, export declined',
    arrive: async (page) => {
      await open(page, '/runs/sample');
      await page.getByRole('button', { name: 'Decline export' }).click();
      await settle(page);
    },
  },
  { name: 'Sign in', arrive: (page) => open(page, '/sign-in') },
  { name: 'Leaderboard', arrive: (page) => open(page, '/leaderboard') },
  { name: 'Threat model', arrive: (page) => open(page, '/threats') },
  { name: 'A run that does not exist', arrive: (page) => open(page, '/runs/no-such-run') },
  { name: 'A report that does not exist', arrive: (page) => open(page, '/findings/no-such-run') },
  { name: 'A page that does not exist', arrive: (page) => open(page, '/no-such-page') },
  {
    name: 'Replay of a discarded run',
    fixture: true,
    arrive: (page) => open(page, '/e2e/connect-states?state=run-discarded'),
  },
  {
    name: 'Header over a live run',
    fixture: true,
    arrive: async (page) => {
      await suppressBootSplash(page);
      await page.goto('/e2e/header-states?mode=live');
      await expect(page.getByRole('banner')).toBeVisible();
      await settle(page);
    },
  },
];

/**
 * THE EXEMPTIONS. Each is a control whose box is under 44 by 44 on purpose, with
 * the reason. Anything not matched here has to pass.
 */
const EXEMPT: { why: string; match: (target: MeasuredTarget, screen: string) => boolean }[] = [
  {
    // A code box, or the step payload, that scrolls inside itself and is
    // focusable so the keyboard can scroll it. A pointer scrolls it from
    // anywhere and nothing in it is activated: it is not a pointer target
    // (WCAG 2.5.8 covers targets for pointer inputs).
    why: 'a focusable scroll region, not a pointer target',
    match: (target) => target.kind === 'scroll-region',
  },
];

const describeTarget = (target: MeasuredTarget) =>
  `${target.width}x${target.height} ${target.selector} "${target.name}"` +
  `${target.inline ? ' (in a sentence)' : ''}${target.disabled ? ' (disabled)' : ''}` +
  `${target.missed ? ` [hit area misses at ${target.missed}]` : ''}`;

for (const viewport of VIEWPORTS) {
  test.describe(`targets at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const screen of SCREENS) {
      if (screen.phoneOnly && viewport.width >= 768) continue;

      test(`${screen.name}: every pointer target is at least 44 by 44`, async ({
        page,
        browserName,
      }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        test.skip(Boolean(screen.fixture) && !FIXTURES_BUILT, NO_FIXTURES);
        await screen.arrive(page);
        await installAudit(page);

        const under = await probeTargets(page, TARGET_MIN);
        const failing = under
          .filter((target) => !target.hitArea)
          .filter((target) => !EXEMPT.some((exemption) => exemption.match(target, screen.name)));
        expect(failing.map(describeTarget), 'targets under 44 by 44').toEqual([]);
      });
    }
  });
}

// ── 3. The active nav item ───────────────────────────────────────────────────

const NAV_PAGES: { path: string; active: string | null; fixture?: boolean }[] = [
  { path: '/', active: 'Home' },
  { path: '/connect', active: 'Connect / Run' },
  { path: '/runs/sample', active: 'Live Replay' },
  // A nested route lights the item its section belongs to.
  { path: '/runs/asi10-goal-drift', active: 'Live Replay' },
  { path: '/leaderboard', active: 'Leaderboard' },
  { path: '/findings/sample', active: 'Findings' },
  { path: '/findings/asi10-goal-drift', active: 'Findings' },
  { path: '/threats', active: 'Threat Model' },
  // A page the deck has no item for lights nothing.
  { path: '/e2e/connect-states?state=run-discarded', active: null, fixture: true },
];

async function readNav(page: Page, navName: string) {
  return page.getByRole('navigation', { name: navName, exact: true }).evaluate((nav) => {
    const current = [...nav.querySelectorAll('[aria-current="page"]')];
    const strays = [...document.querySelectorAll('[aria-current="page"]')].filter(
      (el) => el.closest('nav[aria-label^="Command deck"]') === null,
    );
    const link = current[0] as HTMLElement | undefined;
    const bar = link?.querySelector<HTMLElement>('[data-nav-indicator]') ?? null;
    let indicator: { width: number; height: number; onTop: boolean } | null = null;
    if (bar) {
      const rect = bar.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      indicator = { width: rect.width, height: rect.height, onTop: hit === bar };
    }
    return {
      names: current.map((el) => el.getAttribute('aria-label') ?? el.textContent ?? ''),
      strays: strays.length,
      indicator,
    };
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`the active nav item at ${viewport.width}px`, () => {
    test.use({ viewport });
    const phone = viewport.width < 760;
    const navName = phone ? 'Command deck (mobile)' : 'Command deck';

    for (const where of NAV_PAGES) {
      test(`${where.path}: ${where.active ?? 'no item'} is current`, async ({
        page,
        browserName,
      }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        test.skip(Boolean(where.fixture) && !FIXTURES_BUILT, NO_FIXTURES);
        await open(page, where.path);
        if (phone) {
          await page.getByRole('button', { name: 'Open command deck' }).click();
          await expect(page.getByRole('navigation', { name: navName, exact: true })).toBeVisible();
        }
        await settle(page);
        await installAudit(page);

        const nav = await readNav(page, navName);
        expect(nav.strays, 'aria-current="page" outside the command deck').toBe(0);
        if (where.active === null) {
          expect(nav.names, 'no item is current').toEqual([]);
          return;
        }
        expect(nav.names, 'exactly one current item').toHaveLength(1);
        expect(nav.names[0]!.startsWith(where.active), `current item is ${where.active}`).toBe(
          true,
        );

        // The indicator: a bar, so the state is not carried by colour alone.
        expect(nav.indicator, 'the current item draws an indicator bar').not.toBeNull();
        expect(nav.indicator!.width, 'bar width').toBeGreaterThanOrEqual(INDICATOR_MIN_WIDTH);
        expect(nav.indicator!.height, 'bar height').toBeGreaterThanOrEqual(TARGET_MIN / 2);
        expect(nav.indicator!.onTop, 'the bar is drawn, not clipped or covered').toBe(true);
        const bar = await probePaintContrast(
          page,
          `nav[aria-label="${navName}"] [aria-current="page"] [data-nav-indicator]`,
          'backgroundColor',
        );
        expect(bar?.ratio ?? 0, 'bar against what is under it').toBeGreaterThanOrEqual(
          NON_TEXT_MIN,
        );
        // And an item that is not current draws none.
        const idle = await page
          .getByRole('navigation', { name: navName, exact: true })
          .locator('a:not([aria-current]) [data-nav-indicator]')
          .evaluateAll((bars) =>
            bars.filter((bar) => {
              const style = getComputedStyle(bar);
              return style.display !== 'none' && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
            }),
          );
        expect(idle, 'indicator bars on items that are not current').toHaveLength(0);
      });
    }

    test('the current item follows a navigation inside the app', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await open(page, '/');
      if (phone) await page.getByRole('button', { name: 'Open command deck' }).click();
      const nav = page.getByRole('navigation', { name: navName, exact: true });
      await nav.getByRole('link', { name: /^Threat Model/ }).click();
      await expect(page).toHaveURL(/\/threats$/);
      if (phone) await page.getByRole('button', { name: 'Open command deck' }).click();
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(nav.locator('[aria-current="page"]')).toHaveAttribute(
        'aria-label',
        /^Threat Model/,
      );
    });
  });
}

// ── 4. The skip link on Connect ──────────────────────────────────────────────

const SKIP = 'Skip to run controls';
const REGION = '#run-controls';

interface SkipState {
  name: string;
  fixture?: boolean;
  /** What the keyboard has to land on. */
  lands: 'bar' | 'start';
  arrive: (page: Page) => Promise<void>;
}

const SKIP_STATES: SkipState[] = [
  { name: 'no run, sample mode', lands: 'start', arrive: (page) => open(page, '/connect') },
  {
    name: 'no run, LIVE chosen',
    lands: 'start',
    arrive: async (page) => {
      await open(page, '/connect');
      await page.getByRole('button', { name: /^LIVE/ }).click();
      await settle(page);
    },
  },
  {
    name: 'no run, LIVE chosen, signed in',
    fixture: true,
    lands: 'start',
    arrive: async (page) => {
      await open(page, '/e2e/connect-states?state=waiting');
      await page.getByRole('button', { name: /^LIVE/ }).click();
      await settle(page);
    },
  },
  {
    name: 'run open, waiting for the agent',
    fixture: true,
    lands: 'bar',
    arrive: (page) => issueRun(page, 'waiting'),
  },
  {
    name: 'run open, agent connected',
    fixture: true,
    lands: 'bar',
    arrive: (page) => issueRun(page, 'connected'),
  },
  {
    name: 'run finished',
    fixture: true,
    lands: 'bar',
    arrive: async (page) => {
      await issueRun(page, 'connected');
      await visibleButton(page, /end run and judge/i).click();
      await expect(page.getByRole('button', { name: /new run/i }).first()).toBeVisible();
      await settle(page);
    },
  },
];

/** Put the keyboard on the skip link the way this engine can. */
/**
 * Put the keyboard on the skip link the way this engine can.
 *
 * `fromLoad`: the page has just loaded and nothing has been pressed, so two
 * real Tabs are the whole proof that it is the second stop. After a click
 * elsewhere on the page (a state that had to be set up), Tab would carry on
 * from where the click was, so the first skip link is focused where it stands
 * and one real Tab is pressed from it.
 */
async function focusSkipLink(page: Page, browserName: string, fromLoad = false) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const first = page.getByRole('link', { name: 'Skip to content', exact: true });
  const link = page.getByRole('link', { name: SKIP, exact: true });
  if (browserName === 'webkit') {
    // WebKit's Tab leaves links out of the order. One real Tab puts the page
    // in keyboard mode, then the link is focused where it stands.
    await page.keyboard.press('Tab');
    await link.focus();
  } else {
    if (fromLoad) await page.keyboard.press('Tab');
    else await first.focus();
    await expect(first).toBeFocused();
    await page.keyboard.press('Tab');
  }
  await expect(link).toBeFocused();
  return link;
}

for (const viewport of VIEWPORTS) {
  test.describe(`the skip link on Connect at ${viewport.width}px`, () => {
    test.use({ viewport });

    test('it is the second tab stop, hidden until focused, and styled as the first', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await open(page, '/connect');
      const link = page.getByRole('link', { name: SKIP, exact: true });
      await expect(link, 'the link is in the document').toHaveCount(1);
      await expect(link).toHaveAttribute('href', REGION);

      // In the document it is the second thing the keyboard can reach.
      const order = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('a[href], button, [tabindex="0"]')]
          .slice(0, 2)
          .map((el) => (el.textContent ?? '').trim()),
      );
      expect(order).toEqual(['Skip to content', SKIP]);

      // Not focused: nothing to see. It is clipped away to nothing (the
      // visually-hidden pattern), which keeps it in the tab order and in the
      // accessibility tree.
      const clipped = () => link.evaluate((el) => getComputedStyle(el).clipPath);
      expect(await clipped(), 'not focused: clipped away').toBe('inset(50%)');

      await focusSkipLink(page, browserName, true);
      expect(await clipped(), 'focused: no longer clipped').toBe('none');
      const shown = await link.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        const first = [...document.querySelectorAll('a')].find(
          (a) => (a.textContent ?? '').trim() === 'Skip to content',
        );
        return {
          width: rect.width,
          height: rect.height,
          top: rect.top,
          left: rect.left,
          right: rect.right,
          onTop: hit === el,
          sameClasses: first?.className === el.className,
        };
      });
      expect(shown.width, 'focused: wide enough to hit').toBeGreaterThanOrEqual(TARGET_MIN);
      expect(shown.height, 'focused: tall enough to hit').toBeGreaterThanOrEqual(TARGET_MIN);
      expect(shown.top, 'focused: on screen').toBeGreaterThanOrEqual(0);
      expect(shown.left, 'focused: on screen').toBeGreaterThanOrEqual(0);
      expect(shown.right, 'focused: on screen').toBeLessThanOrEqual(viewport.width);
      expect(shown.onTop, 'focused: drawn over the header, not under it').toBe(true);
      expect(shown.sameClasses, 'styled exactly as "Skip to content"').toBe(true);
    });

    test('no other page has it, and it arrives with a navigation to Connect', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await open(page, '/');
      const link = page.getByRole('link', { name: SKIP, exact: true });
      await expect(link).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Skip to content', exact: true })).toHaveCount(1);
      // The shell is a layout, which a navigation inside the app does not draw
      // again: the link has to follow the route by itself.
      const phone = viewport.width < 760;
      if (phone) await page.getByRole('button', { name: 'Open command deck' }).click();
      await page
        .getByRole('navigation', {
          name: phone ? 'Command deck (mobile)' : 'Command deck',
          exact: true,
        })
        .getByRole('link', { name: /^Connect \/ Run/ })
        .click();
      await expect(page).toHaveURL(/\/connect$/);
      await expect(link).toHaveCount(1);
    });

    for (const state of SKIP_STATES) {
      test(`${state.name}: it moves the keyboard to the ${
        state.lands === 'bar' ? 'run bar' : 'block that starts a run'
      }`, async ({ page, browserName }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        test.skip(Boolean(state.fixture) && !FIXTURES_BUILT, NO_FIXTURES);
        await state.arrive(page);
        await expect(page.locator(REGION), 'one region carries the id').toHaveCount(1);

        await focusSkipLink(page, browserName);
        await page.keyboard.press('Enter');
        await expect(page.locator(REGION)).toBeFocused();
        await settle(page);

        const landed = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const header = document.querySelector('header')!.getBoundingClientRect();
          const labelledBy = el.getAttribute('aria-labelledby');
          const name =
            el.getAttribute('aria-label') ??
            (labelledBy ? (document.getElementById(labelledBy)?.textContent ?? '') : '');
          // A point just inside the region's top left corner: is it the region
          // that is drawn there, or something laid over it?
          const hit = document.elementFromPoint(
            Math.max(rect.left, 0) + 12,
            Math.max(rect.top, header.bottom) + 6,
          );
          return {
            isBar: el.matches('section[aria-labelledby="connect-state"]'),
            inBottomSlot: el.closest('[data-testid="run-bar-slot"]') !== null,
            tabindex: el.getAttribute('tabindex'),
            name: name.trim(),
            live: el.getAttribute('aria-live') ?? el.getAttribute('role') ?? '',
            outlineStyle: style.outlineStyle,
            outlineWidth: parseFloat(style.outlineWidth),
            outlineOffset: parseFloat(style.outlineOffset),
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            headerBottom: header.bottom,
            viewportHeight: window.innerHeight,
            viewportWidth: document.documentElement.clientWidth,
            uncovered: hit !== null && (hit === el || el.contains(hit)),
            controls: [
              ...el.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)'),
            ].filter((control) => control.checkVisibility({ visibilityProperty: true })).length,
          };
        });

        expect(landed.isBar, 'the keyboard is on the run bar').toBe(state.lands === 'bar');
        if (state.lands === 'bar') {
          // On a phone held upright the bar is the one in the bottom slot.
          expect(landed.inBottomSlot, 'the bar held at the bottom of a phone').toBe(
            viewport.width < 768,
          );
        }
        expect(landed.tabindex, 'focusable by script, not a tab stop').toBe('-1');
        expect(landed.name.length, 'the region has a name').toBeGreaterThan(0);
        expect(landed.live, 'the region is not a live region').not.toMatch(
          /status|alert|polite|assertive/,
        );
        // The block that starts a run always holds the control that starts it.
        // The bar holds END RUN AND JUDGE once an agent has connected; while it
        // waits, on a phone, it is the reading alone (DISCARD RUN sits in the
        // run column there), and that reading is what the reader came for.
        if (state.lands === 'start') {
          expect(landed.controls, 'the block holds the control that starts a run').toBeGreaterThan(
            0,
          );
        }

        // The shared ring, whole: drawn inside the region, so neither the
        // screen edge nor a clipping box can cut it.
        expect(landed.outlineStyle).toBe('solid');
        expect(landed.outlineWidth).toBeGreaterThanOrEqual(2);
        expect(landed.outlineOffset, 'ring drawn inside the region').toBeLessThan(0);

        // Not under the header, and on screen.
        expect(landed.top, 'clear of the header').toBeGreaterThanOrEqual(landed.headerBottom - 0.5);
        expect(landed.top, 'on screen').toBeLessThan(landed.viewportHeight);
        expect(landed.left).toBeGreaterThanOrEqual(-0.5);
        expect(landed.right).toBeLessThanOrEqual(landed.viewportWidth + 0.5);
        expect(landed.uncovered, 'nothing is drawn over the region').toBe(true);
        if (state.lands === 'bar') {
          expect(landed.bottom, 'the whole bar is on screen').toBeLessThanOrEqual(
            landed.viewportHeight + 0.5,
          );
        }

        // Where the region holds a control, the next Tab goes on to it, not
        // back to the top of the page.
        if (browserName !== 'webkit' && landed.controls > 0) {
          await page.keyboard.press('Tab');
          const inside = await page.evaluate(() =>
            document.getElementById('run-controls')!.contains(document.activeElement),
          );
          expect(inside, 'Tab carries on into the region').toBe(true);
        }
      });
    }
  });
}

// ── 5. Hover ─────────────────────────────────────────────────────────────────

test.describe('hover on rows that can be clicked', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('every :hover rule is inside @media (hover: hover)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'One engine is enough to read the stylesheet.');
    await open(page, '/');
    const report = await page.evaluate(() => {
      const outside: string[] = [];
      let hoverRules = 0;
      const walk = (rules: CSSRuleList, guarded: boolean, parentHover: boolean) => {
        for (const rule of rules) {
          let nowGuarded = guarded;
          let nowHover = parentHover;
          if (rule instanceof CSSMediaRule && /hover:\s*hover/.test(rule.conditionText)) {
            nowGuarded = true;
          }
          if (rule instanceof CSSStyleRule) {
            if (rule.selectorText.includes(':hover')) nowHover = true;
            if (nowHover && rule.style.length > 0) {
              hoverRules += 1;
              if (!nowGuarded) outside.push(rule.selectorText);
            }
          }
          const nested = (rule as CSSGroupingRule).cssRules;
          if (nested) walk(nested, nowGuarded, nowHover);
        }
      };
      for (const sheet of document.styleSheets) walk(sheet.cssRules, false, false);
      return { outside, hoverRules };
    });
    expect(report.hoverRules, 'hover rules found').toBeGreaterThan(5);
    expect(report.outside, ':hover rules a touch screen would also get').toEqual([]);
  });

  const ROWS: {
    name: string;
    fixture?: boolean;
    arrive: (page: Page) => Promise<void>;
    row: string;
  }[] = [
    {
      name: 'Home, a Core-7 sample row',
      arrive: (page) => open(page, '/'),
      row: 'nav[aria-label="Core-7 sample runs"] li:nth-child(3) a',
    },
    {
      name: 'Connect, a client tab that is not chosen',
      fixture: true,
      arrive: (page) => issueRun(page, 'waiting'),
      row: '[role="group"][aria-label="MCP client"] button[aria-pressed="false"]',
    },
    {
      name: 'Connect, a run mode that is not chosen',
      arrive: (page) => open(page, '/connect'),
      row: '[role="group"][aria-label="Run mode"] button[aria-pressed="false"]',
    },
    {
      name: 'the command deck, an item that is not current',
      arrive: (page) => open(page, '/'),
      row: 'nav[aria-label="Command deck"] a:not([aria-current])',
    },
  ];

  for (const where of ROWS) {
    test(`${where.name}: a pointer over it changes it and moves nothing`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'Hover needs a pointer that hovers: Chromium only.');
      test.skip(Boolean(where.fixture) && !FIXTURES_BUILT, NO_FIXTURES);
      await where.arrive(page);
      const row = page.locator(where.row).first();
      await row.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      const read = () =>
        row.evaluate((el) => {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const marks = [...el.querySelectorAll<HTMLElement>('[data-hover-mark]')].map(
            (mark) => getComputedStyle(mark).textDecorationLine,
          );
          return {
            paint: [style.backgroundColor, style.borderTopColor, style.color].join(' | '),
            marks: marks.join(','),
            box: [rect.left, rect.top, rect.width, rect.height].map((n) => Math.round(n * 10) / 10),
            cursor: style.cursor,
          };
        });
      const before = await read();
      await row.hover();
      await settle(page);
      const over = await read();
      expect(over.paint, 'the row is painted differently under a pointer').not.toBe(before.paint);
      expect(over.box, 'and nothing moved').toEqual(before.box);
      expect(over.cursor).toBe('pointer');
    });
  }

  test('Home, a Core-7 sample row: the change is not colour alone', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Hover needs a pointer that hovers: Chromium only.');
    await open(page, '/');
    const row = page.locator('nav[aria-label="Core-7 sample runs"] li:nth-child(3) a');
    const mark = row.locator('[data-hover-mark]');
    await page.mouse.move(0, 0);
    await expect(mark).toHaveCSS('text-decoration-line', 'none');
    await row.hover();
    await expect(mark).toHaveCSS('text-decoration-line', 'underline');
  });
});
