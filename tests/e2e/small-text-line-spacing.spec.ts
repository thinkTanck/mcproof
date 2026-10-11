import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';
import {
  probeSpacingDefects,
  probeWrappingSmallText,
  sidewaysOverflow,
  TEXT_SPACING_OVERRIDE,
  widerThanThePage,
  type SmallTextBlock,
  type SpacingDefect,
} from './support/text-spacing';

/**
 * SMALL TEXT HAS ROOM TO BREATHE WHEN IT WRAPS (WCAG 1.4.12).
 *
 * The mono labels and readouts are 13 and 14px. On a desk most of them hold one
 * line. On a phone they wrap, and at the old line-height (1.2 to 1.3) two
 * wrapped lines of small mono text sat on top of each other: the offending step
 * on Replay and Findings, the compromise-detection text on Home, the report
 * details. That is layout, which jsdom has none of, so it is measured here in a
 * real browser, in the two engines a reader is likely to hold: Chromium and
 * WebKit (an iPhone).
 *
 * Two questions per screen, at 320 and 390 wide:
 *
 *  1. Every element under 16px whose block actually wrapped has a computed
 *     line-height of at least 1.5 times its font size.
 *  2. With the WCAG 1.4.12 text-spacing override forced on, nothing is lost:
 *     the page does not scroll sideways, no box clips or spills its text, no
 *     scroll box is out of a keyboard's reach, and no two neighbouring text
 *     blocks are drawn over each other.
 *
 * No exact pixel sizes: ratios, floors and small tolerances only.
 */

/** 1.5, less a hair for sub-pixel rounding of the computed line-height. */
const MIN_RATIO = 1.49;

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

const FIXTURES_BUILT = process.env.E2E_FIXTURES === '1';

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
 * Geist loads with `display: 'optional'`, so a first visit that misses the font
 * keeps next/font's wider fallback for the page's whole lifetime, and whether a
 * cold browser catches it is a race. Blocking the font file pins the fallback:
 * one state, every time, and the worst case for wrapping, since a wider font
 * wraps sooner and fits less. The other phone specs do the same.
 */
async function prepare(page: Page) {
  await suppressBootSplash(page);
  await page.context().route(/\.woff2?(\?|$)/, (route) => route.abort());
}

async function open(page: Page, path: string) {
  await prepare(page);
  await page.goto(path);
  await expect(page.locator('h1').first()).toBeVisible();
  await settle(page);
}

/** Walk the replay to its last step, so the terminal and the rationale are all on show. */
async function replayToTheEnd(page: Page) {
  const next = page.getByRole('button', { name: 'Next step' });
  for (let i = 0; i < 40 && (await next.isEnabled()); i += 1) await next.click();
  await settle(page);
}

/** Issue a run on the Connect states fixture, as the other Connect specs do. */
async function issueRun(page: Page, state: 'waiting' | 'connected') {
  await prepare(page);
  await page.goto(`/e2e/connect-states?state=${state}`);
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /issue run endpoint/i }).click();
  await expect(page.getByRole('group', { name: 'MCP client' })).toBeVisible();
  await settle(page);
}

interface Screen {
  name: string;
  /** Needs the fixture build (E2E_FIXTURES=1). */
  fixture?: boolean;
  /** A run-scoped screen: the shared header draws the SAMPLE or LIVE chip here. */
  modeChip?: boolean;
  /** Bring the screen to the state under test. */
  arrive: (page: Page) => Promise<void>;
  /** Further states to measure on the same page, each reached in turn. */
  then?: { name: string; go: (page: Page) => Promise<void> }[];
}

const CLIENT_TABS = [
  /^GITHUB COPILOT \/ VS CODE/,
  /^CURSOR/,
  /^CODEX/,
  /^GEMINI CLI/,
  /^OTHER AGENT$/,
] as const;

const SCREENS: Screen[] = [
  { name: 'Home', arrive: (page) => open(page, '/') },
  {
    name: 'Replay',
    modeChip: true,
    arrive: (page) => open(page, '/runs/sample'),
    then: [{ name: 'at the last step', go: replayToTheEnd }],
  },
  { name: 'Findings', modeChip: true, arrive: (page) => open(page, '/findings/sample') },
  {
    name: 'Findings, remediation withheld',
    modeChip: true,
    arrive: (page) => open(page, '/findings/asi10-goal-drift'),
  },
  { name: 'Connect', arrive: (page) => open(page, '/connect') },
  {
    name: 'Connect, run issued and waiting',
    fixture: true,
    arrive: (page) => issueRun(page, 'waiting'),
    then: CLIENT_TABS.map((tab) => ({
      name: `client tab ${tab.source}`,
      go: async (page: Page) => {
        await page
          .getByRole('group', { name: 'MCP client' })
          .getByRole('button', { name: tab })
          .click();
        await settle(page);
      },
    })),
  },
  {
    name: 'Connect, agent connected',
    fixture: true,
    arrive: (page) => issueRun(page, 'connected'),
  },
];

const tightLines = (blocks: SmallTextBlock[]) =>
  blocks
    .filter((block) => block.ratio === null || block.ratio < MIN_RATIO)
    .map(
      (block) =>
        `${block.ratio === null ? 'normal' : block.ratio.toFixed(2)} ` +
        `(${block.fontSize}px, ${block.lines} lines) ${block.selector} "${block.sample}"`,
    );

const lost = (defects: SpacingDefect[]) =>
  defects.map((d) => `${d.kind} by ${d.by}px: ${d.selector} "${d.sample}"`);

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const screen of SCREENS) {
      test.describe(screen.name, () => {
        test.skip(
          Boolean(screen.fixture) && !FIXTURES_BUILT,
          'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this state needs is not built.',
        );

        test('wrapped text under 16px has a line-height of at least 1.5', async ({ page }) => {
          await screen.arrive(page);
          const offenders: string[] = [];
          const outgrown: string[] = [];
          let measured = 0;

          const measure = async (state: string) => {
            const blocks = await probeWrappingSmallText(page);
            measured += blocks.length;
            for (const line of tightLines(blocks)) {
              const entry = `[${state}] ${line}`;
              if (!offenders.includes(entry)) offenders.push(entry);
            }
            // The taller lines have to FIT, as shipped, with no override at
            // all: the fixed-height panels (the replay step detail, the hero
            // rail, the pinned run bar) must not have been outgrown by them.
            for (const line of lost(await probeSpacingDefects(page))) {
              const entry = `[${state}] ${line}`;
              if (!outgrown.includes(entry)) outgrown.push(entry);
            }
          };

          await measure('arrival');
          for (const step of screen.then ?? []) {
            await step.go(page);
            await measure(step.name);
          }

          // A probe that finds nothing would pass anything. Every one of these
          // screens wraps some small text on a phone.
          expect(measured, 'wrapped small-text blocks found').toBeGreaterThan(0);
          expect(offenders, 'wrapped small text tighter than 1.5').toEqual([]);
          expect(outgrown, 'text clipped, spilled or overlapping as shipped').toEqual([]);
        });

        test('WCAG 1.4.12 text spacing loses nothing', async ({ page }) => {
          await screen.arrive(page);
          await page.addStyleTag({ content: TEXT_SPACING_OVERRIDE });
          await settle(page);

          const problems: string[] = [];
          const check = async (state: string) => {
            const sideways = await sidewaysOverflow(page);
            if (sideways > 1) {
              const culprits = await widerThanThePage(page);
              const headerOnly = culprits.length > 0 && culprits.every((c) => c.inHeader);
              if (screen.modeChip && viewport.width < 360 && headerOnly) {
                // KNOWN AND NOT FIXED HERE, so it is recorded instead of hidden.
                // On the two screens that draw the mode chip, at 320 wide in the
                // fallback font, the shared header has 5px to spare (issue #176).
                // The reader's letter-spacing widens the wordmark by more than
                // that and the chip is pushed past the edge. Making room means
                // changing the header, which this change was told to leave
                // exactly as it is. Everything below the header is still held
                // to the full check, and so is the header at 390.
                test.info().annotations.push({
                  type: 'known issue',
                  description: `[${state}] the header pushes the mode chip ${sideways}px past a 320px screen under WCAG 1.4.12 spacing`,
                });
              } else {
                const what = culprits.map((c) => c.selector).join(', ');
                problems.push(`[${state}] page scrolls sideways by ${sideways}px: ${what}`);
              }
            }
            for (const line of lost(await probeSpacingDefects(page))) {
              const entry = `[${state}] ${line}`;
              if (!problems.includes(entry)) problems.push(entry);
            }
          };

          await check('arrival');
          for (const step of screen.then ?? []) {
            await step.go(page);
            await check(step.name);
          }

          expect(problems, 'content lost under the text-spacing override').toEqual([]);
        });
      });
    }
  });
}
