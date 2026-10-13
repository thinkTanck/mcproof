import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';
import { probeAsiCodes, probeBreachColour, type AsiMention } from './support/words-meaning';

/**
 * WORDS AND MEANING (UI audit 2026-10-12, batch C; WCAG 1.4.1, 3.1.3, 3.1.4, 4.1.2).
 *
 * Measured in a real browser, at a phone width and a desk width, on every page
 * and every state that needs no account:
 *
 *  1. NO ASI CODE WITHOUT ITS NAME. Every `ASI01` to `ASI10` in visible text
 *     (also `ASI 01` and `ASI-01`) is named where a reader can see it without
 *     hovering: in the same element, in the same row, or through an
 *     `aria-describedby` tie to an element that is visible on the same page and
 *     spells the name. A `title` attribute does not count. The places that use
 *     the tie instead of an inline name are annotated on the test, by name.
 *
 *     EXEMPT, and only this: prose QUOTED from a trace, a recorded verdict or a
 *     generated report. It is evidence and is printed as it was recorded. Each
 *     such container carries `data-asi-quoted` with one of the reasons in
 *     QUOTED_REASONS, and a container with any other reason fails.
 *
 *  2. THE HOME PAGE SAYS WHAT THE PRODUCT DOES. One plain sentence under the
 *     headline, and a text badge, "Maps to OWASP Agentic Top 10", with no logo.
 *
 *  3. "OWASP AGENTIC TOP 10" IS EXPLAINED, and the explanation opens with
 *     Enter, with Space and with a tap, says whether it is open, moves nothing
 *     above it and adds no live region.
 *
 *  4. A BREACH IS NEVER RED ALONE. Every visible element painted in the breach
 *     red has a label (one of BREACH_WORDS, on it, beside it or in its row) or
 *     a mark that is named with one.
 *
 * WebKit runs all of it at the phone width.
 *
 * No exact pixel sizes: the only numbers are floors and "did not move".
 */

const FIXTURES_BUILT = process.env.E2E_FIXTURES === '1';
const TARGET_MIN = 44;

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

const WEBKIT_IS_A_PHONE = 'WebKit stands in for an iPhone: it is measured at the phone width.';
const NO_FIXTURES =
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this state needs is not built.';

/** The only reasons a container may give for holding prose that is not rewritten. */
const QUOTED_REASONS = ['trace', 'judge-rationale', 'generated-report'];

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

/** The status bar on its own, over an invented run. The fixture has no heading. */
async function openHeaderFixture(page: Page, mode: 'live' | 'sample') {
  await suppressBootSplash(page);
  await page.goto(`/e2e/header-states?mode=${mode}`);
  await expect(page.getByRole('banner')).toBeVisible();
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

const nextStep = (page: Page) =>
  page.getByRole('button', { name: 'Next step' }).filter({ visible: true });

/** Step a replay to its last step and let the last line finish typing. */
async function toLastStep(page: Page) {
  const next = nextStep(page);
  for (let i = 0; i < 40 && (await next.isEnabled()); i += 1) await next.click();
  await page.waitForTimeout(1500);
  await settle(page);
}

/** Step a replay to the step its verdict is anchored to. */
async function toCompromiseStep(page: Page) {
  const outcome = await page.getByTestId('run-outcome').first().innerText();
  const anchored = Number(/STEP (\d+)/.exec(outcome)?.[1] ?? 1);
  const next = nextStep(page);
  for (let i = 1; i < anchored; i += 1) await next.click();
  await page.waitForTimeout(1500);
  await settle(page);
}

interface Screen {
  name: string;
  fixture?: boolean;
  arrive: (page: Page) => Promise<void>;
}

/** One sample run per Core-7 class. `sample` is the featured one. */
const SAMPLE_RUNS = [
  'sample',
  'asi01-goal-hijack',
  'asi03-identity-privilege-abuse',
  'asi04-run',
  'asi05-code-execution',
  'asi06-run',
  'asi10-goal-drift',
];

const SCREENS: Screen[] = [
  { name: 'Home', arrive: (page) => open(page, '/') },
  {
    name: 'Home, explanation open',
    arrive: async (page) => {
      await open(page, '/');
      await page.getByTestId('owasp-explainer').locator('summary').click();
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
  { name: 'Connect, run issued', fixture: true, arrive: (page) => issueRun(page, 'waiting') },
  {
    name: 'Connect, run issued, another category then picked',
    fixture: true,
    arrive: async (page) => {
      await issueRun(page, 'waiting');
      await page.getByRole('radio', { name: /ASI01/ }).click();
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
  { name: 'Connect, run expired', fixture: true, arrive: (page) => issueRun(page, 'expired') },
  {
    name: 'Replay of a discarded run',
    fixture: true,
    arrive: (page) => open(page, '/e2e/connect-states?state=run-discarded'),
  },
  {
    name: 'Report of a discarded run',
    fixture: true,
    arrive: (page) => open(page, '/e2e/connect-states?state=report-discarded'),
  },
  ...SAMPLE_RUNS.flatMap((run): Screen[] => [
    { name: `Replay ${run}, first step`, arrive: (page) => open(page, `/runs/${run}`) },
    {
      name: `Replay ${run}, at the compromise step`,
      arrive: async (page) => {
        await open(page, `/runs/${run}`);
        await toCompromiseStep(page);
      },
    },
    {
      name: `Replay ${run}, last step`,
      arrive: async (page) => {
        await open(page, `/runs/${run}`);
        await toLastStep(page);
      },
    },
    { name: `Report ${run}`, arrive: (page) => open(page, `/findings/${run}`) },
  ]),
  { name: 'Leaderboard, nothing measured', arrive: (page) => open(page, '/leaderboard') },
  { name: 'Threats', arrive: (page) => open(page, '/threats') },
  { name: 'Account, signed out', arrive: (page) => open(page, '/account') },
  { name: 'Sign-in', arrive: (page) => open(page, '/sign-in') },
  { name: 'Page not found', arrive: (page) => open(page, '/no-such-page') },
  { name: 'Run not found', arrive: (page) => open(page, '/runs/no-such-run') },
  {
    name: 'Header over a live run',
    fixture: true,
    arrive: (page) => openHeaderFixture(page, 'live'),
  },
  {
    name: 'Header over a sample run',
    fixture: true,
    arrive: (page) => openHeaderFixture(page, 'sample'),
  },
];

const describeMention = (mention: AsiMention) =>
  `${mention.code} written "${mention.written}" in ${mention.where} ("${mention.text}")`;

// ── 1 and 4. Codes and breach colour, screen by screen ───────────────────────

for (const viewport of VIEWPORTS) {
  test.describe(`words and meaning at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const screen of SCREENS) {
      test(`${screen.name}: every ASI code is named, and no breach is red alone`, async ({
        page,
        browserName,
      }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        test.skip(Boolean(screen.fixture) && !FIXTURES_BUILT, NO_FIXTURES);
        await screen.arrive(page);

        const mentions = await probeAsiCodes(page);
        const bare = mentions.filter((mention) => mention.naming === 'bare');
        expect.soft(bare.map(describeMention), 'ASI codes drawn without their name').toEqual([]);

        const quoted = mentions.filter((mention) => mention.naming === 'quoted');
        expect
          .soft(
            quoted
              .filter((mention) => !QUOTED_REASONS.includes(mention.reason))
              .map(describeMention),
            'a quoted container must give one of the listed reasons',
          )
          .toEqual([]);
        for (const mention of quoted) {
          test.info().annotations.push({
            type: 'quoted, not rewritten',
            description: `${mention.reason}: ${describeMention(mention)}`,
          });
        }
        for (const mention of mentions.filter((m) => m.naming === 'legend')) {
          test.info().annotations.push({
            type: 'named through aria-describedby',
            description: describeMention(mention),
          });
        }

        const red = await probeBreachColour(page);
        expect
          .soft(
            red
              .filter((paint) => paint.indicator === 'none')
              .map((paint) => `${paint.property} on ${paint.where} ("${paint.text}")`),
            'breach red with no label and no named mark',
          )
          .toEqual([]);
      });
    }

    test('every container of quoted prose gives a listed reason', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      const seen: string[] = [];
      for (const path of ['/runs/sample', '/findings/sample', '/findings/asi10-goal-drift']) {
        await open(page, path);
        seen.push(
          ...(await page
            .locator('[data-asi-quoted]')
            .evaluateAll((nodes) =>
              nodes.map((node) => node.getAttribute('data-asi-quoted') ?? ''),
            )),
        );
      }
      expect(seen.length, 'quoted containers found').toBeGreaterThan(0);
      expect(seen.filter((reason) => !QUOTED_REASONS.includes(reason))).toEqual([]);
    });

    // ── 2. Home: the subhead and the badge ─────────────────────────────────

    test('Home says what the product does, in one sentence under the headline', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await open(page, '/');
      const subhead = page.getByTestId('home-subhead');
      await expect(subhead).toBeVisible();
      const read = await subhead.evaluate((el) => {
        const heading = document.getElementById('home-title')!;
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
          afterHeading: heading.nextElementSibling === el,
          below: el.getBoundingClientRect().top >= heading.getBoundingClientRect().bottom - 1,
          family: getComputedStyle(el).fontFamily,
          headingFamily: getComputedStyle(heading).fontFamily,
          textTransform: getComputedStyle(el).textTransform,
        };
      });
      expect(read.tag).toBe('p');
      expect(read.afterHeading, 'directly after the headline').toBe(true);
      expect(read.below, 'under the headline').toBe(true);
      expect(read.text).toMatch(/^MCProof /);
      expect(read.text, 'one sentence').toMatch(/^[^.!?]+\.$/);
      expect(read.text, 'no em dash').not.toMatch(/—/);
      expect(read.text, 'no number that could drift').not.toMatch(/\d/);
      expect(read.family, 'READING role: the sans the headline is set in').toBe(read.headingFamily);
      expect(read.textTransform).toBe('none');
    });

    test('Home carries the badge "Maps to OWASP Agentic Top 10", text only', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await open(page, '/');
      const badge = page.getByTestId('owasp-badge');
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText('Maps to OWASP Agentic Top 10');
      const read = await badge.evaluate((el) => {
        const heading = document.getElementById('home-title')!;
        const style = getComputedStyle(el);
        const root = getComputedStyle(document.documentElement);
        const resolve = (token: string) => {
          const probe = document.createElement('span');
          probe.style.color = root.getPropertyValue(token).trim();
          document.body.appendChild(probe);
          const colour = getComputedStyle(probe).color;
          probe.remove();
          return colour;
        };
        return {
          pictures: el.querySelectorAll('svg, img, picture, canvas').length,
          background: style.backgroundImage,
          colour: style.color,
          border: style.borderTopColor,
          breach: [resolve('--status-breach'), resolve('--text-breach')],
          caution: resolve('--status-caution'),
          family: style.fontFamily,
          href: el.getAttribute('href') ?? el.closest('a')?.getAttribute('href') ?? null,
          section: el.closest('section')?.getAttribute('aria-labelledby') ?? '',
          gap: Math.abs(el.getBoundingClientRect().top - heading.getBoundingClientRect().bottom),
          viewport: window.innerHeight,
        };
      });
      expect(read.pictures, 'no logo and no icon').toBe(0);
      expect(read.background, 'no logo drawn as a background').toBe('none');
      expect(read.breach, 'never the breach red').not.toContain(read.colour);
      expect(read.colour, 'never the caution amber').not.toBe(read.caution);
      expect(read.breach, 'no red border').not.toContain(read.border);
      expect(read.family.toLowerCase(), 'INSTRUMENT role: mono').toMatch(/mono/);
      expect(read.href, 'it goes where the claim is spelled out').toBe('/threats');
      expect(read.section, 'in the headline block').toBe('home-title');
      expect(read.gap, 'near the headline').toBeLessThan(read.viewport / 2);
    });

    // ── 3. The explanation ──────────────────────────────────────────────────

    test('the explanation opens and closes with Enter, Space and a tap', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await open(page, '/');
      const details = page.getByTestId('owasp-explainer');
      const summary = details.locator('summary');
      const body = page.getByTestId('owasp-explainer-body');
      const isOpen = () => details.evaluate((el) => (el as HTMLDetailsElement).open);
      const above = () =>
        page.evaluate(() =>
          ['#home-title', '[data-testid="home-subhead"]', '[data-testid="owasp-badge"]'].map(
            (selector) => {
              const rect = document.querySelector(selector)!.getBoundingClientRect();
              return [Math.round(rect.top + window.scrollY), Math.round(rect.height)];
            },
          ),
        );
      const liveRegions = () =>
        page.locator('[aria-live], [role="status"], [role="alert"], [role="log"]').count();

      await expect(summary).toBeVisible();
      await expect(summary).toHaveText(/OWASP Agentic Top 10/);
      expect(await details.evaluate((el) => el.tagName.toLowerCase()), 'a native disclosure').toBe(
        'details',
      );
      expect(await isOpen(), 'closed when the page opens').toBe(false);
      await expect(body).toBeHidden();
      const restingAbove = await above();
      const restingLive = await liveRegions();

      const box = await summary.boundingBox();
      expect(box?.width ?? 0, 'target width').toBeGreaterThanOrEqual(TARGET_MIN);
      expect(box?.height ?? 0, 'target height').toBeGreaterThanOrEqual(TARGET_MIN);

      // Keyboard: Enter opens.
      await summary.focus();
      await expect(summary).toBeFocused();
      const ring = await summary.evaluate((el) => {
        const style = getComputedStyle(el);
        return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
      });
      if (browserName !== 'webkit') {
        // `.focus()` from a script does not match :focus-visible in WebKit.
        expect(ring.style, 'the shared focus ring').not.toBe('none');
        expect(ring.width).toBeGreaterThanOrEqual(2);
      }
      await page.keyboard.press('Enter');
      expect(await isOpen(), 'Enter opens it').toBe(true);
      await expect(body).toBeVisible();
      await expect(body).toContainText(/OWASP/);
      const link = body.getByRole('link');
      await expect(link, 'one link, to the coverage board').toHaveCount(1);
      await expect(link).toHaveAttribute('href', '/threats');
      expect(await above(), 'nothing above it moved').toEqual(restingAbove);
      expect(await liveRegions(), 'no live region was added').toBe(restingLive);

      // The content is reachable: the next Tab stop is the link inside it.
      if (browserName !== 'webkit') {
        await page.keyboard.press('Tab');
        await expect(link).toBeFocused();
        await summary.focus();
      }

      // Keyboard: Space closes.
      await page.keyboard.press('Space');
      expect(await isOpen(), 'Space closes it').toBe(false);
      await expect(body).toBeHidden();
      expect(await above(), 'nothing above it moved').toEqual(restingAbove);

      // Pointer or finger.
      if (browserName === 'webkit') await summary.tap();
      else await summary.click();
      expect(await isOpen(), 'a tap opens it').toBe(true);
      await expect(body).toBeVisible();
      if (browserName === 'webkit') await summary.tap();
      else await summary.click();
      expect(await isOpen(), 'a second tap closes it').toBe(false);
    });
  });
}

// ── No sideways scroll where a name was added ────────────────────────────────

for (const width of [320, 360, 390]) {
  test.describe(`names fit at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const path of [
      '/',
      '/connect',
      '/runs/sample',
      '/runs/asi04-run',
      '/findings/sample',
      '/findings/asi10-goal-drift',
      '/findings/asi04-run',
      '/threats',
      '/leaderboard',
    ]) {
      test(`${path} does not scroll sideways`, async ({ page }) => {
        await open(page, path);
        if (path === '/') {
          await page.getByTestId('owasp-explainer').locator('summary').click();
          await settle(page);
        }
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, 'page wider than the screen').toBeLessThanOrEqual(1);
      });
    }

    test('Connect with a run issued does not scroll sideways', async ({ page }) => {
      test.skip(!FIXTURES_BUILT, NO_FIXTURES);
      await issueRun(page, 'connected');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'page wider than the screen').toBeLessThanOrEqual(1);
    });
  });
}
