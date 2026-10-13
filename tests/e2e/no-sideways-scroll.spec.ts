import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';
import { widerThanThePage } from './support/text-spacing';

/**
 * NO PAGE SCROLLS SIDEWAYS ON A PHONE (issue #221; UI audit 2026-10-13, batch E).
 *
 * On WebKit at 360px wide, in the fallback font, the two screens that draw the
 * mode chip (the replay and the fix report) scrolled sideways by about 6px. The
 * header's row needed 365.5px there: the menu button, the wordmark, the chip
 * and the gaps between them, none of which can shrink. The header let the chip
 * run up to 8px PAST the screen edge before it would wrap, so a row 5.5px too
 * wide was drawn off the screen instead. Chromium's fallback font is 6px
 * narrower, which is why only WebKit showed it.
 *
 * So this is measured where it happened and around it: at 320, 360 and 390
 * wide, in Chromium and WebKit, in the loaded font and with the font file
 * blocked (next/font's wider fallback, which a first visit can keep for the
 * page's whole life). The five pages of the audit round are the required
 * scope, at every one of those. The other pages are held to the same line, and
 * so are the Connect states a real run reaches (in the fallback font, the
 * wider one, and in both fonts at 360), because a sideways scroll is the same
 * defect wherever it is.
 *
 * For each: the document is not wider than the screen, the body is not, and no
 * element reaches more than a pixel past the right edge. That last one names
 * what to look at when the first two fail.
 *
 * The header has to hold its ONE row while it does this. Letting the chip drop
 * to a second row would also stop the scroll, and at normal text size that is
 * its own defect (a 96px header), so the chip screens are also held to the set
 * header height at every phone width, 420 to 430 included: in the fallback
 * font the row needs up to 431.5px with its 18px padding, and there the chip
 * did drop to a second row.
 *
 * One test walks one width in one font, a step per page, so a failure names the
 * page and the rest of the walk still runs. No exact sizes: comparisons, a one
 * pixel rounding tolerance, and the header's height against the token it is
 * set from.
 */

const FIXTURES_BUILT = process.env.E2E_FIXTURES === '1';

type Font = 'loaded font' | 'fallback font';
const FONTS: Font[] = ['loaded font', 'fallback font'];

const PHONES = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
] as const;

async function prepare(page: Page, font: Font) {
  await suppressBootSplash(page);
  if (font === 'fallback font') {
    // The same pin tests/e2e/header-fallback-font.spec.ts uses.
    await page.context().route(/\.woff2?(\?|$)/, (route) => route.abort());
  }
}

/** Web fonts landed (or failed), and two frames for layout to follow. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function issue(page: Page, state: 'waiting' | 'connected') {
  await page.goto(`/e2e/connect-states?state=${state}`);
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /issue run endpoint/i }).click();
  await expect(page.getByRole('region', { name: /what we have actually seen/i })).toBeVisible();
}

interface State {
  name: string;
  /** One of the five pages of the audit round: the required scope. */
  required?: boolean;
  fixture?: boolean;
  /** Draws the mode chip in its header. */
  chip?: boolean;
  arrive: (page: Page) => Promise<unknown>;
}

const STATES: State[] = [
  { name: 'Home', required: true, arrive: (page) => page.goto('/') },
  { name: 'Connect', required: true, arrive: (page) => page.goto('/connect') },
  {
    name: 'the sample report',
    required: true,
    chip: true,
    arrive: (page) => page.goto('/findings/sample'),
  },
  {
    name: 'the sample replay',
    required: true,
    chip: true,
    arrive: (page) => page.goto('/runs/sample'),
  },
  { name: 'Sign in', required: true, arrive: (page) => page.goto('/sign-in') },
  { name: 'Leaderboard', arrive: (page) => page.goto('/leaderboard') },
  { name: 'Threat model', arrive: (page) => page.goto('/threats') },
  { name: 'a page that does not exist', arrive: (page) => page.goto('/no-such-page') },
  { name: 'Connect, run issued', fixture: true, arrive: (page) => issue(page, 'waiting') },
  { name: 'Connect, agent connected', fixture: true, arrive: (page) => issue(page, 'connected') },
  {
    name: 'Connect, run finished',
    fixture: true,
    arrive: async (page) => {
      await issue(page, 'connected');
      await page.getByRole('button', { name: /end run and judge/i }).click();
      await expect(page.getByText('RUN FINISHED').first()).toBeVisible();
    },
  },
  {
    name: 'Connect, run discarded',
    fixture: true,
    arrive: async (page) => {
      await issue(page, 'waiting');
      await page
        .getByRole('button', { name: 'DISCARD RUN', exact: true })
        .filter({ visible: true })
        .click();
      await page.getByRole('button', { name: 'DISCARD', exact: true }).click();
      await expect(page.getByText('RUN DISCARDED').first()).toBeVisible();
    },
  },
  {
    name: 'a discarded run page',
    fixture: true,
    arrive: (page) => page.goto('/e2e/connect-states?state=run-discarded'),
  },
  {
    name: 'a live run header',
    fixture: true,
    chip: true,
    arrive: (page) => page.goto('/e2e/header-states?mode=live'),
  },
];

const REQUIRED = STATES.filter((state) => state.required);
const CHIP_STATES = STATES.filter((state) => state.chip);

/** What is wrong with the page's width right now; an empty list is none. */
async function sidewaysProblems(page: Page, tolerance = 0): Promise<string[]> {
  const { html, body } = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  const past = (await widerThanThePage(page)).map(
    (found) => `${found.selector}${found.inHeader ? ' (in the header)' : ''}`,
  );
  const problems: string[] = [];
  if (html > tolerance) problems.push(`the document is ${html}px wider than the screen`);
  if (body > tolerance) problems.push(`the body is ${body}px wider than the screen`);
  // `widerThanThePage` already allows the one pixel of rounding.
  if (tolerance === 0 || html > tolerance) {
    for (const selector of past) problems.push(`past the right edge: ${selector}`);
  }
  return problems;
}

/** What is wrong with the header's row on a chip screen; an empty list is none. */
async function rowProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const header = document.querySelector('header')!;
    const probe = document.createElement('div');
    probe.style.height = 'var(--header-h)';
    document.body.append(probe);
    const set = probe.getBoundingClientRect().height;
    probe.remove();
    const centre = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    };
    const word = [...header.querySelectorAll('span')]
      .filter((n) => /^(SAMPLE|LIVE)$/.test(n.textContent ?? ''))
      .pop();
    const chip = word?.parentElement;
    if (!chip) return ['no mode chip in the header'];
    const home = header.querySelector('a[aria-label="MCProof home"]')!;
    const box = chip.getBoundingClientRect();
    const screen = document.documentElement.clientWidth;
    const round = (n: number) => Math.round(n * 10) / 10;
    const problems: string[] = [];
    const height = header.getBoundingClientRect().height;
    if (Math.abs(height - set) > 0.5) {
      problems.push(`the header is ${round(height)}px tall, set to ${set}px`);
    }
    // One row: the chip's centre is level with the wordmark's.
    if (Math.abs(centre(chip) - centre(home)) > 2) {
      problems.push('the chip is not on the row of the wordmark');
    }
    if (box.left < home.getBoundingClientRect().right - 0.5) {
      problems.push('the chip starts over the wordmark');
    }
    if (box.right > screen + 0.5) {
      problems.push(`the chip ends ${round(box.right - screen)}px past the screen`);
    }
    return problems;
  });
}

for (const viewport of PHONES) {
  for (const font of FONTS) {
    test.describe(`${viewport.width}px wide, ${font}`, () => {
      test.use({ viewport });

      test('the five pages do not scroll sideways, and a chip keeps the one header row', async ({
        page,
      }) => {
        await prepare(page, font);
        for (const state of REQUIRED) {
          await test.step(state.name, async () => {
            await state.arrive(page);
            await settle(page);
            expect.soft(await sidewaysProblems(page), state.name).toEqual([]);
            if (state.chip) expect.soft(await rowProblems(page), state.name).toEqual([]);
          });
        }
      });

      test('nor do the other pages', async ({ page }) => {
        await prepare(page, font);
        for (const state of STATES.filter((s) => !s.required && !s.fixture)) {
          await test.step(state.name, async () => {
            await state.arrive(page);
            await settle(page);
            expect.soft(await sidewaysProblems(page), state.name).toEqual([]);
          });
        }
      });

      // The states a real run reaches: in the wider font at every width, and in
      // both fonts at 360, where #221 was.
      if (font === 'fallback font' || viewport.width === 360) {
        test('nor do the states of a run, on Connect and after it', async ({ page }) => {
          test.skip(
            !FIXTURES_BUILT,
            'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture routes these states need are not built.',
          );
          test.slow();
          await prepare(page, font);
          for (const state of STATES.filter((s) => s.fixture)) {
            await test.step(state.name, async () => {
              await state.arrive(page);
              await settle(page);
              expect.soft(await sidewaysProblems(page), state.name).toEqual([]);
              if (state.chip) expect.soft(await rowProblems(page), state.name).toEqual([]);
            });
          }
        });
      }
    });
  }
}

/**
 * THE CHIP SCREENS KEEP ONE HEADER ROW AT NORMAL TEXT SIZE, at the widths
 * between and beyond the three above, where the header's spacing changes
 * (360, 420, 480) and where the larger phones are (375, 428, 430). The
 * fallback font is the one that does not fit, so it is the one measured.
 */
for (const width of [359, 375, 419, 420, 428, 430, 479, 480]) {
  test.describe(`${width}px wide, fallback font`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('a chip screen keeps one header row, with the chip on the screen', async ({ page }) => {
      await prepare(page, 'fallback font');
      for (const state of CHIP_STATES) {
        if (state.fixture && !FIXTURES_BUILT) continue;
        await test.step(state.name, async () => {
          await state.arrive(page);
          await settle(page);
          expect.soft(await rowProblems(page), state.name).toEqual([]);
          expect.soft(await sidewaysProblems(page), state.name).toEqual([]);
        });
      }
    });
  });
}

/**
 * ENLARGED TEXT AT 360. tests/e2e/large-text-wraps.spec.ts holds 320 and 390;
 * 360 is where #221 was, so the five pages are held there too, both ways of
 * doubling text, in the fallback font. Whatever the header does to make room
 * (it may wrap, it may grow), the page still does not scroll sideways and the
 * chip is still whole and on the screen.
 */
for (const mode of ['root 200%', 'doubled in place'] as const) {
  test.describe(`360px wide, text at ${mode}, fallback font`, () => {
    test.use({ viewport: { width: 360, height: 800 } });

    test('the five pages do not scroll sideways', async ({ page }) => {
      await prepare(page, 'fallback font');
      for (const state of REQUIRED) {
        await test.step(state.name, async () => {
          await state.arrive(page);
          await settle(page);
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

          // The same one pixel the enlarged-text spec allows for rounding.
          expect.soft(await sidewaysProblems(page, 1), state.name).toEqual([]);
          if (state.chip) {
            const chip = page.getByRole('banner').getByText(/^(SAMPLE|LIVE)$/);
            const box = (await chip.boundingBox())!;
            expect
              .soft(box.x, `${state.name}: the chip starts on the screen`)
              .toBeGreaterThan(-0.5);
            expect
              .soft(box.x + box.width, `${state.name}: the chip ends on the screen`)
              .toBeLessThanOrEqual(360 + 1);
          }
        });
      }
    });
  });
}
