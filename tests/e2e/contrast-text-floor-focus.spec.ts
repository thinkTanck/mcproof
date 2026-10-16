import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { suppressBootSplash } from './support/screen';
import {
  installAudit,
  probeContrast,
  probeContrastOf,
  probeFocusStops,
  probeSmallText,
  type ContrastPair,
} from './support/ui-audit';

/**
 * TEXT CAN BE READ, IS NEVER TINY, AND THE KEYBOARD CAN ALWAYS BE SEEN
 * (UI audit 2026-10-12, batch A; WCAG 1.4.3, 1.4.4, 2.4.7, 2.4.13).
 *
 * Measured in a real browser on the five pages of the audit (Home, Connect, a
 * report, the sample replay, Sign in) and the states of each that need no
 * account, at a phone width and a desk width:
 *
 *  1. CONTRAST. Every piece of rendered text is at least 7:1 against what is
 *     painted under it. axe's `color-contrast` rule reports zero violations,
 *     and every node axe could not decide (text over a gradient or a
 *     translucent panel, which it marks "incomplete") is computed here and held
 *     to the same 7:1. A disabled control is exempt under WCAG 1.4.3; its
 *     label is still held to 3:1, so it cannot fade further than it has.
 *     Chromium only: Playwright's Windows WebKit crashes inside this axe rule.
 *
 *  2. THE TEXT FLOOR. No rendered text is drawn under 12px. Checked twice: as
 *     shipped, and with the browser's own text size turned down (a root font
 *     size of 12px), which is where a rem-based step used to drop to 9px.
 *
 *  3. FOCUS. Tab through the whole page. Every stop wears the one shared ring:
 *     a solid outline at least 2px wide, at least 3:1 against the background
 *     it is drawn on, the same width and colour at every stop, and not cut off
 *     by a box that clips or by the edge of the screen.
 *
 * The 12px and focus checks also run in WebKit, at the phone width.
 *
 * No exact pixel sizes: the only numbers are the floors above.
 */

const FIXTURES_BUILT = process.env.E2E_FIXTURES === '1';

const TEXT_MIN = 7; // owner ruling 2026-10-15 (UI and copy PR): 7:1, was 7:1
/** A disabled label is exempt, but it is not allowed to fade below this. */
const DISABLED_MIN = 3;
const TEXT_FLOOR = 12;
const RING_MIN_WIDTH = 2;
const RING_MIN_CONTRAST = 3;

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

/** Let web fonts land and every finite animation finish, so colours are at rest. */
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
async function issueRun(page: Page, state: 'waiting' | 'connected') {
  await open(page, `/e2e/connect-states?state=${state}`);
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /start a run/i }).click();
  await expect(page.getByRole('group', { name: 'MCP client' })).toBeVisible();
  await settle(page);
}

interface Screen {
  name: string;
  /** Needs the fixture build (E2E_FIXTURES=1). */
  fixture?: boolean;
  /** Only where the layout has this state. */
  phoneOnly?: boolean;
  /** Playback is running, so the page is not walked with Tab. */
  moving?: boolean;
  arrive: (page: Page) => Promise<void>;
}

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
    name: 'Connect, run issued and waiting',
    fixture: true,
    arrive: (page) => issueRun(page, 'waiting'),
  },
  {
    name: 'Connect, run issued, OTHER AGENT tab',
    fixture: true,
    arrive: async (page) => {
      await issueRun(page, 'waiting');
      await page
        .getByRole('group', { name: 'MCP client' })
        .getByRole('button', { name: /^OTHER AGENT$/ })
        .click();
      await settle(page);
    },
  },
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
      await page
        .getByRole('button', { name: 'DISCARD RUN', exact: true })
        .filter({ visible: true })
        .first()
        .click();
      await expect(page.getByRole('button', { name: /keep running/i })).toBeVisible();
      await settle(page);
    },
  },
  {
    name: 'Connect, run finished',
    fixture: true,
    arrive: async (page) => {
      await issueRun(page, 'connected');
      await page
        .getByRole('button', { name: /end run and get result/i })
        .filter({ visible: true })
        .first()
        .click();
      await expect(page.getByRole('button', { name: /new run/i }).first()).toBeVisible();
      await settle(page);
    },
  },
  { name: 'Report', arrive: (page) => open(page, '/findings/sample') },
  {
    name: 'Report, remediation withheld',
    arrive: (page) => open(page, '/findings/asi10-goal-drift'),
  },
  { name: 'Replay, paused at the first step', arrive: (page) => open(page, '/runs/sample') },
  {
    name: 'Replay, playing',
    moving: true,
    arrive: async (page) => {
      await open(page, '/runs/sample');
      await page.getByRole('button', { name: 'Play' }).click();
      await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    },
  },
  {
    name: 'Replay, at the last step',
    arrive: async (page) => {
      await open(page, '/runs/sample');
      const next = page.getByRole('button', { name: 'Next step' });
      for (let i = 0; i < 40 && (await next.isEnabled()); i += 1) await next.click();
      await settle(page);
    },
  },
  { name: 'Sign in', arrive: (page) => open(page, '/sign-in') },
];

const line = (pair: ContrastPair) =>
  `${pair.ratio}:1 ${pair.fg} on ${pair.bg} (${pair.fontSize}px ${pair.kind}` +
  `${pair.disabled ? ', disabled' : ''}) ${pair.selector} "${pair.sample}"`;

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const screen of SCREENS) {
      if (screen.phoneOnly && viewport.width >= 768) continue;

      test.describe(screen.name, () => {
        test.skip(
          Boolean(screen.fixture) && !FIXTURES_BUILT,
          'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this state needs is not built.',
        );

        test('text is at least 7:1 against its background', async ({ page, browserName }) => {
          test.skip(
            browserName !== 'chromium',
            "Chromium only: Playwright's Windows WebKit crashes inside axe's color-contrast rule.",
          );
          await screen.arrive(page);
          await installAudit(page);

          const pairs = await probeContrast(page);
          // A probe that finds nothing would pass anything.
          expect(pairs.length, 'pieces of text measured').toBeGreaterThan(5);
          expect(
            pairs.filter((pair) => !pair.disabled && pair.ratio < TEXT_MIN).map(line),
            'text under 7:1',
          ).toEqual([]);
          expect(
            pairs.filter((pair) => pair.disabled && pair.ratio < DISABLED_MIN).map(line),
            'a disabled label that has faded under 3:1',
          ).toEqual([]);

          const axe = await new AxeBuilder({ page })
            .withRules(['color-contrast-enhanced'])
            .analyze();
          expect(
            axe.violations.flatMap((violation) =>
              violation.nodes.map((node) => node.target.join(' ')),
            ),
            'axe color-contrast-enhanced violations',
          ).toEqual([]);

          // What axe could not decide is decided here, one node at a time.
          const undecided: string[] = [];
          for (const node of axe.incomplete.flatMap((result) => result.nodes)) {
            const target = node.target.join(' ');
            const own = await probeContrastOf(page, target);
            if (!own) undecided.push(`not measured: ${target}`);
            else if (own.ratio < (own.disabled ? DISABLED_MIN : TEXT_MIN))
              undecided.push(line(own));
          }
          expect(undecided, 'nodes axe left incomplete that are not 7:1 when computed').toEqual([]);
        });

        test('no text is drawn under 12px, and every tab stop shows the shared ring', async ({
          page,
          browserName,
        }) => {
          test.skip(
            browserName === 'webkit' && viewport.width >= 768,
            'WebKit stands in for an iPhone: it is measured at the phone width.',
          );
          await screen.arrive(page);
          await installAudit(page);

          const tiny = (await probeSmallText(page, TEXT_FLOOR)).map(
            (text) => `${text.rendered}px ${text.selector} "${text.sample}"`,
          );
          expect.soft(tiny, 'text drawn under 12px').toEqual([]);

          if (!screen.moving) {
            // WebKit's Tab leaves links out of the order, so there every tabbable
            // control is focused in turn after one real key press.
            const stops = await probeFocusStops(page, {
              walk: browserName === 'webkit' ? 'script' : 'tab',
            });
            expect(stops.length, 'tab stops measured').toBeGreaterThan(1);

            const describeStop = (stop: (typeof stops)[number]) =>
              `${stop.selector} "${stop.name}": outline ${stop.outlineStyle} ${stop.outlineWidth}px ` +
              `${stop.outlineColor}, ${stop.ringContrast}:1`;
            expect
              .soft(
                stops
                  .filter(
                    (stop) =>
                      stop.outlineStyle !== 'solid' ||
                      stop.outlineWidth < RING_MIN_WIDTH ||
                      stop.ringContrast < RING_MIN_CONTRAST,
                  )
                  .map(describeStop),
                'tab stops without a solid ring of at least 2px and 3:1',
              )
              .toEqual([]);
            expect
              .soft(
                stops
                  .filter((stop) => stop.clipped)
                  .map((stop) => `${stop.selector} "${stop.name}": cut off at ${stop.clipped}`),
                'tab stops whose ring is cut off',
              )
              .toEqual([]);
            expect
              .soft(
                [...new Set(stops.map((stop) => `${stop.outlineWidth}px ${stop.outlineColor}`))],
                'one ring: the same width and colour at every stop',
              )
              .toHaveLength(1);
          }

          // The browser's own text size turned down. A step set in rem follows
          // the root, so this is where the floor has to hold by itself.
          await page.addStyleTag({ content: 'html { font-size: 12px; }' });
          await settle(page);
          const tinyWhenSmall = (await probeSmallText(page, TEXT_FLOOR)).map(
            (text) => `${text.rendered}px ${text.selector} "${text.sample}"`,
          );
          expect
            .soft(tinyWhenSmall, 'text drawn under 12px with the browser text size turned down')
            .toEqual([]);
        });
      });
    }
  });
}
