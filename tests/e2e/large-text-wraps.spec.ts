import { test, expect, type Locator, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';
import { widerThanThePage } from './support/text-spacing';

/**
 * ENLARGED TEXT WRAPS, IT IS NOT CUT OFF (WCAG 1.4.4, sweep 2026-10-10, S5).
 *
 * A reader who doubles their text on a phone still has to be able to read and
 * press everything. Measured on 718e049, these were cut instead: the finished
 * run's NEW RUN, an expired run's ISSUE A FRESH RUN and the discard confirm's
 * KEEP RUNNING (Connect); the replay's speed buttons; the SAMPLE chip, which
 * pushed the page sideways on Replay and both Findings pages; the Google button
 * on Sign in; and the Codex and Gemini file labels on the client tabs.
 *
 * Two ways of doubling text, the two the sweep used:
 *
 *  - root 200%: the root font size set to 200%, what a browser's "font size"
 *    setting does. The site sizes its type in px, so this grows the rem-based
 *    spacing and controls, not the words.
 *  - doubled in place: every element's computed font size doubled, what a
 *    text-only zoom does. This is the one that enlarges the words.
 *
 * Each state is measured at 320 and 390 wide, in Chromium and WebKit, in the
 * wider fallback font (the worst case for wrapping). For each named element:
 * its text stays inside its own box, the box is not wider than its content
 * allows, nothing that hides overflow cuts it, it stays on the screen, and a
 * control stays at least 44px tall. The page never scrolls sideways.
 *
 * At normal text size nothing may change: the guards at the bottom hold the
 * header to its set height and the rows to the shapes they had, at 320 and 1280.
 *
 * No exact pixel sizes: floors, ceilings, tolerances and relations only.
 */

const FIXTURES_BUILT = process.env.E2E_FIXTURES === '1';

/** Sub-pixel rounding and the little a glyph's side bearing reaches past its box. */
const TOLERANCE = 2;
/** The touch-target floor, less a hair for sub-pixel rounding. */
const MIN_TARGET = 43.5;

type Mode = 'root 200%' | 'doubled in place';
const MODES: Mode[] = ['root 200%', 'doubled in place'];

const PHONES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

/** Let web fonts land and every finite animation finish, so boxes are at rest. */
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

/**
 * Pin next/font's wider fallback by blocking the font file: one state every
 * time, and the worst case, since a wider font wraps sooner.
 */
async function prepare(page: Page) {
  await suppressBootSplash(page);
  await page.context().route(/\.woff2?(\?|$)/, (route) => route.abort());
}

async function enlarge(page: Page, mode: Mode) {
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
      els.forEach((el, i) => el.style.setProperty('font-size', `${sizes[i]! * 2}px`, 'important'));
    });
  }
  // Two frames for layout to settle on the new sizes.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

const bar = (page: Page) => page.getByRole('region', { name: /what we have actually seen/i });
const picker = (page: Page) => page.getByRole('group', { name: 'MCP client' });

async function issue(page: Page, state: 'waiting' | 'connected' | 'expired') {
  await prepare(page);
  await page.goto(`/e2e/connect-states?state=${state}`);
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /issue run endpoint/i }).click();
}

async function open(page: Page, path: string) {
  await prepare(page);
  await page.goto(path);
  await expect(page.locator('h1').first()).toBeVisible();
  await settle(page);
}

/** The mode chip in the shared header. */
const chip = (page: Page) => page.getByRole('banner').getByText(/^(SAMPLE|LIVE)$/);

interface Target {
  name: string;
  locate: (page: Page) => Locator;
  /** A control the reader presses: held to the 44px floor as well. */
  control?: boolean;
}

interface State {
  name: string;
  fixture?: boolean;
  arrive: (page: Page) => Promise<void>;
  targets: Target[];
  /** Scroll boxes whose text must stay reachable by scrolling, never cut sideways. */
  scrollers?: Target[];
}

const STATES: State[] = [
  {
    name: 'Connect, finished run',
    fixture: true,
    arrive: async (page) => {
      await issue(page, 'connected');
      await page.getByRole('button', { name: /end run and judge/i }).click();
      await expect(bar(page).getByText('RUN FINISHED')).toBeVisible();
      await settle(page);
    },
    targets: [
      {
        name: 'REPLAY',
        control: true,
        locate: (page) => bar(page).getByRole('link', { name: 'Open the replay' }),
      },
      {
        name: 'NEW RUN',
        control: true,
        locate: (page) => bar(page).getByRole('button', { name: /new run/i }),
      },
    ],
  },
  {
    name: 'Connect, expired run',
    fixture: true,
    arrive: async (page) => {
      await issue(page, 'expired');
      await expect(page.getByRole('button', { name: 'ISSUE A FRESH RUN' })).toBeVisible();
      await settle(page);
    },
    targets: [
      {
        name: 'ISSUE A FRESH RUN',
        control: true,
        locate: (page) => page.getByRole('button', { name: 'ISSUE A FRESH RUN' }).first(),
      },
    ],
  },
  {
    name: 'Connect, discard confirm open',
    fixture: true,
    arrive: async (page) => {
      await issue(page, 'waiting');
      await page
        .getByRole('button', { name: 'DISCARD RUN', exact: true })
        .filter({ visible: true })
        .click();
      await expect(page.getByRole('button', { name: 'KEEP RUNNING' })).toBeVisible();
      await settle(page);
    },
    targets: [
      {
        name: 'KEEP RUNNING',
        control: true,
        locate: (page) => page.getByRole('button', { name: 'KEEP RUNNING' }),
      },
      {
        name: 'DISCARD',
        control: true,
        locate: (page) => page.getByRole('button', { name: 'DISCARD', exact: true }),
      },
    ],
  },
  {
    name: 'Connect, Codex tab',
    fixture: true,
    arrive: async (page) => {
      await issue(page, 'waiting');
      await picker(page)
        .getByRole('button', { name: /^CODEX/ })
        .click();
      await settle(page);
    },
    targets: [
      {
        name: 'the Codex file label',
        locate: (page) =>
          page.locator('[data-testid=copy-out-file]', { hasText: 'config.toml' }).locator('..'),
      },
    ],
  },
  {
    name: 'Connect, Gemini CLI tab',
    fixture: true,
    arrive: async (page) => {
      await issue(page, 'waiting');
      await picker(page)
        .getByRole('button', { name: /^GEMINI CLI/ })
        .click();
      await settle(page);
    },
    targets: [
      {
        name: 'the Gemini file label',
        locate: (page) =>
          page.locator('[data-testid=copy-out-file]', { hasText: 'settings.json' }).locator('..'),
      },
    ],
  },
  {
    name: 'Replay',
    arrive: (page) => open(page, '/runs/sample'),
    targets: [
      { name: 'the SAMPLE chip', locate: chip },
      ...['0.5', '1', '2', '4'].map((speed) => ({
        name: `the ${speed}x speed button`,
        control: true,
        locate: (page: Page) =>
          page
            .getByRole('group', { name: 'Playback speed' })
            .getByRole('button', { name: `${speed}×`, exact: true }),
      })),
    ],
    scrollers: [
      {
        name: 'the terminal',
        locate: (page) =>
          page.getByRole('list', { name: 'Attack replay step timeline' }).locator('..'),
      },
      {
        name: 'the verdict lines',
        locate: (page) => page.getByRole('complementary', { name: 'Detector verdict' }),
      },
    ],
  },
  {
    name: 'Findings',
    arrive: (page) => open(page, '/findings/sample'),
    targets: [{ name: 'the SAMPLE chip', locate: chip }],
  },
  {
    name: 'Findings, remediation withheld',
    arrive: (page) => open(page, '/findings/asi10-goal-drift'),
    targets: [{ name: 'the SAMPLE chip', locate: chip }],
  },
  {
    name: 'Sign in',
    arrive: (page) => open(page, '/sign-in'),
    targets: [
      {
        name: 'Google',
        control: true,
        locate: (page) => page.getByRole('button', { name: /continue with google/i }),
      },
      {
        name: 'GitHub',
        control: true,
        locate: (page) => page.getByRole('button', { name: /continue with github/i }),
      },
    ],
  },
];

/**
 * Everything wrong with one element: text running outside it, content wider
 * than it, cut by an ancestor that hides overflow, or off the screen.
 */
function cutReport(locator: Locator, tolerance: number): Promise<string[]> {
  return locator.evaluate((el, tol) => {
    const problems: string[] = [];
    const box = el.getBoundingClientRect();
    const round = (n: number) => Math.round(n);

    // Its own content does not run past its own box.
    if (el.scrollWidth > el.clientWidth + tol) {
      problems.push(`content is ${round(el.scrollWidth - el.clientWidth)}px wider than the box`);
    }
    const style = getComputedStyle(el);
    const hides = (v: string) => v === 'hidden' || v === 'clip';
    if (hides(style.overflowY) && el.scrollHeight > el.clientHeight + tol) {
      problems.push(`content is ${round(el.scrollHeight - el.clientHeight)}px taller than the box`);
    }

    // The ink of its text sits inside it.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim()) continue;
      const owner = node.parentElement;
      if (owner && !owner.checkVisibility()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width <= 0.5) continue;
        const past = Math.max(r.right - box.right, box.left - r.left);
        if (past > tol) problems.push(`"${node.nodeValue.trim()}" runs ${round(past)}px outside`);
      }
    }

    // Nothing above it that hides overflow cuts it.
    for (
      let cur = el.parentElement;
      cur && cur !== document.documentElement;
      cur = cur.parentElement
    ) {
      const s = getComputedStyle(cur);
      if (s.overflowX === 'visible') continue;
      const frame = cur.getBoundingClientRect();
      const past = Math.max(box.right - frame.right, frame.left - box.left);
      if (past > tol) {
        const name = `${cur.tagName.toLowerCase()}.${[...cur.classList].slice(0, 3).join('.')}`;
        problems.push(`cut ${round(past)}px by ${name} (overflow-x ${s.overflowX})`);
      }
    }

    // It is on the screen, in page coordinates: once the page can scroll
    // sideways, bringing the element into view scrolls it there.
    const width = document.documentElement.clientWidth;
    const left = box.left + window.scrollX;
    const right = box.right + window.scrollX;
    if (right > width + tol || left < -tol) {
      problems.push(`reaches ${round(Math.max(right - width, -left))}px past the screen`);
    }
    return problems;
  }, tolerance);
}

/**
 * A scroll box may hold more than it shows, as long as the rest is reached by
 * scrolling it (and a keyboard can get in) and no line is cut sideways.
 */
function scrollerReport(locator: Locator, tolerance: number): Promise<string[]> {
  return locator.evaluate((el, tol) => {
    const problems: string[] = [];
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (el.scrollHeight > el.clientHeight + tol) {
      if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') {
        problems.push(`taller than its box with overflow-y ${style.overflowY}`);
      }
      const reachable =
        (el as HTMLElement).tabIndex >= 0 ||
        el.querySelector('a[href], button, [tabindex]:not([tabindex="-1"])') !== null;
      if (!reachable) problems.push('scrolls, but nothing in it takes keyboard focus');
    }
    if (el.scrollWidth > el.clientWidth + tol) {
      problems.push(
        `lines are ${Math.round(el.scrollWidth - el.clientWidth)}px wider than the box`,
      );
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim()) continue;
      const owner = node.parentElement;
      if (owner && !owner.checkVisibility()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width <= 0.5) continue;
        const past = Math.max(r.right - box.right, box.left - r.left);
        if (past > tol) {
          problems.push(`"${node.nodeValue.trim().slice(0, 30)}" runs ${Math.round(past)}px past`);
        }
      }
    }
    return problems;
  }, tolerance);
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const viewport of PHONES) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const state of STATES) {
      test.describe(state.name, () => {
        test.skip(
          Boolean(state.fixture) && !FIXTURES_BUILT,
          'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this state needs is not built.',
        );

        for (const mode of MODES) {
          test(`text at ${mode} wraps instead of being cut`, async ({ page }) => {
            await state.arrive(page);
            await enlarge(page, mode);

            const problems: string[] = [];
            const over = await sideways(page);
            if (over > 1) {
              const what = (await widerThanThePage(page)).map((c) => c.selector).join(', ');
              problems.push(`the page scrolls sideways by ${over}px: ${what}`);
            }

            for (const target of state.targets) {
              const locator = target.locate(page);
              await expect(locator, target.name).toBeVisible();
              // Measured where it lies, never scrolled to: scrolling an element
              // into view also scrolls a box that hides overflow, which would
              // bring the cut part into sight and hide the defect.
              for (const p of await cutReport(locator, TOLERANCE)) {
                problems.push(`${target.name}: ${p}`);
              }
              if (target.control) {
                const b = await locator.boundingBox();
                if (b && b.height < MIN_TARGET) {
                  problems.push(`${target.name}: under 44px tall`);
                }
              }
            }
            for (const scroller of state.scrollers ?? []) {
              const locator = scroller.locate(page);
              await expect(locator, scroller.name).toBeVisible();
              for (const p of await scrollerReport(locator, TOLERANCE)) {
                problems.push(`${scroller.name}: ${p}`);
              }
            }

            expect(problems, `cut off at ${mode}`).toEqual([]);
          });
        }
      });
    }
  });
}

/**
 * AT NORMAL TEXT SIZE NOTHING MOVES. The wrapping above may only ever happen
 * when the text is enlarged: these hold the shapes the rows had.
 */
for (const viewport of [
  { width: 320, height: 568 },
  { width: 1280, height: 900 },
] as const) {
  test.describe(`at normal text size, ${viewport.width}px`, () => {
    test.use({ viewport });

    async function sameRow(a: Locator, b: Locator) {
      const ba = (await a.boundingBox())!;
      const bb = (await b.boundingBox())!;
      const centre = (x: { y: number; height: number }) => x.y + x.height / 2;
      expect(Math.abs(centre(ba) - centre(bb)), 'drawn on one row').toBeLessThanOrEqual(TOLERANCE);
    }

    /** How many lines an element's visible text is laid out on. */
    function lines(locator: Locator): Promise<number> {
      return locator.evaluate((el) => {
        const centres: number[] = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.nodeValue?.trim() || !node.parentElement?.checkVisibility()) continue;
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) {
            if (r.width <= 0.5) continue;
            const c = r.top + r.height / 2;
            if (!centres.some((x) => Math.abs(x - c) < r.height / 2)) centres.push(c);
          }
        }
        return centres.length;
      });
    }

    async function headerHolds(page: Page) {
      const { height, set } = await page.evaluate(() => {
        const header = document.querySelector('header')!;
        const probe = document.createElement('div');
        probe.style.height = 'var(--header-h)';
        document.body.append(probe);
        const set = probe.getBoundingClientRect().height;
        probe.remove();
        return { height: header.getBoundingClientRect().height, set };
      });
      expect(Math.abs(height - set), 'the header is its set height').toBeLessThanOrEqual(0.5);
    }

    test('Replay: the header holds its height, the chip sits beside the wordmark', async ({
      page,
    }) => {
      await open(page, '/runs/sample');
      await headerHolds(page);
      await sameRow(chip(page), page.getByRole('link', { name: 'MCProof home' }));
      const speeds = page.getByRole('group', { name: 'Playback speed' }).getByRole('button');
      await expect(speeds).toHaveCount(4);
      await sameRow(speeds.first(), speeds.last());
      expect(await lines(chip(page))).toBe(1);
    });

    test('Findings: the header holds its height, the chip sits beside the wordmark', async ({
      page,
    }) => {
      await open(page, '/findings/sample');
      await headerHolds(page);
      await sameRow(chip(page), page.getByRole('link', { name: 'MCProof home' }));
    });

    test('Sign in: GitHub and Google share one row at one width', async ({ page }) => {
      await open(page, '/sign-in');
      const github = page.getByRole('button', { name: /continue with github/i });
      const google = page.getByRole('button', { name: /continue with google/i });
      await sameRow(github, google);
      expect(await lines(google)).toBe(1);
      const [a, b] = [(await github.boundingBox())!, (await google.boundingBox())!];
      expect(Math.abs(a.width - b.width), 'the two are one width').toBeLessThanOrEqual(TOLERANCE);
    });

    test.describe('Connect', () => {
      test.skip(!FIXTURES_BUILT, 'NOT COVERED: E2E_FIXTURES=1 is unset.');

      test('the finished pair shares one row', async ({ page }) => {
        await STATES[0]!.arrive(page);
        await sameRow(
          bar(page).getByRole('link', { name: 'Open the replay' }),
          bar(page).getByRole('button', { name: /new run/i }),
        );
        expect(await lines(bar(page).getByRole('button', { name: /new run/i }))).toBe(1);
      });

      test('DISCARD and KEEP RUNNING each hold one line, on one row at desktop width', async ({
        page,
      }) => {
        await STATES[2]!.arrive(page);
        const discard = page.getByRole('button', { name: 'DISCARD', exact: true });
        const keep = page.getByRole('button', { name: 'KEEP RUNNING' });
        expect(await lines(discard)).toBe(1);
        expect(await lines(keep)).toBe(1);
        // At 320 KEEP RUNNING already sat on a row of its own before this change.
        if (viewport.width >= 1280) await sameRow(discard, keep);
      });

      test('ISSUE A FRESH RUN holds one line on an expired run', async ({ page }) => {
        await STATES[1]!.arrive(page);
        expect(await lines(STATES[1]!.targets[0]!.locate(page))).toBe(1);
      });

      test('the Codex file label is one line at desktop width', async ({ page }) => {
        test.skip(viewport.width < 1280, 'a phone may wrap it at any size');
        await STATES[3]!.arrive(page);
        expect(await lines(STATES[3]!.targets[0]!.locate(page))).toBe(1);
      });
    });
  });
}
