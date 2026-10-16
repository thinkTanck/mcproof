import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * READABILITY AND HIERARCHY (UI audit 2026-10-12, batch D; WCAG 1.3.1, 1.4.1,
 * 1.4.8, 1.4.12, 2.4.4, 4.1.3).
 *
 * Measured in a real browser, at a phone width and a desk width:
 *
 *  1. BODY PARAGRAPHS HOLD A READING MEASURE. Every paragraph of prose is no
 *     wider than the `measure` utility (a fixed 34rem, about 66 characters; see
 *     reading-measure.spec.ts for why it is rem and not `ch`), its longest line
 *     is between 45 and 80 characters at 1280, and at 390 it is never wider
 *     than the box it sits in. A paragraph in a card narrower than the measure
 *     is held by the card and is not asked for the floor.
 *
 *  2. A HEADLINE HAS A LINE-HEIGHT OF 1.2 TO 1.3. Every element in a heading
 *     role (`reading-h1`, `reading-h2`, `reading-h3`), and every `h1`. A small
 *     mono label that happens to sit in an `h2` tag is a label, not a headline:
 *     it keeps the 1.5 that small-text-line-spacing.spec.ts holds it to.
 *
 *  3. PRECISION, RECALL AND CLASSIFICATION ACCURACY ARE DRAWN BY ONE COMPONENT,
 *     at one size, each with a label and a sentence saying what it measures.
 *     They stay TWO measurements: two groups, each with its own provenance line.
 *
 *  4. "READ FULL RESULTS" IS A LINK ON A LINE OF ITS OWN, under the figures,
 *     underlined, at least 44px tall, with a name that says results of what.
 *
 *  5. THE FREE-RUNS NOTE is drawn from `LIVE_RUN_ALLOWANCE` beside the Connect
 *     call to action, and is not drawn when that is 0, unset, empty or not a
 *     whole number. The build under test has it unset, so the real pages show
 *     no note; the shown state is drawn by a fixture route that renders the
 *     same blocks with a value handed in.
 *
 *  6. THE REPLAY HAS A COLOUR KEY, visible, named, tied to the thing it
 *     explains with `aria-describedby`, and it is not a live region.
 *
 *  7. ONE LIVE REGION, AND THIS BATCH ADDS NONE. The count on each page and
 *     state is the count measured on main at 863aa72.
 *
 * WebKit runs all of it at the phone width.
 *
 * No exact pixel sizes: ceilings, floors, ranges, ratios and "comes after".
 */

const FIXTURES_BUILT = process.env.E2E_FIXTURES === '1';
const TARGET_MIN = 44;
/** Sub-pixel rounding. */
const HAIR = 1;

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
] as const;

const WEBKIT_IS_A_PHONE = 'WebKit stands in for an iPhone: it is measured at the phone width.';
const NO_FIXTURES =
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this state needs is not built.';

const PAGES: { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  { name: 'connect', path: '/connect' },
  { name: 'report', path: '/findings/sample' },
  { name: 'report, classification unreliable', path: '/findings/asi10-goal-drift' },
  { name: 'replay', path: '/runs/sample' },
  { name: 'sign-in', path: '/sign-in' },
  { name: 'leaderboard', path: '/leaderboard' },
  { name: 'threats', path: '/threats' },
];

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

/** The Connect fixture with a run issued and waiting for an agent. */
async function openIssuedRun(page: Page) {
  await suppressBootSplash(page);
  await page.goto('/e2e/connect-states?state=waiting');
  await page.getByRole('button', { name: /^LIVE/ }).click();
  await page.getByRole('button', { name: /start a run/i }).click();
  await expect(page.getByRole('region', { name: /what we have recorded so far/i })).toBeVisible();
  await settle(page);
}

// ── 1. the reading measure ────────────────────────────────────────────────

interface Paragraph {
  text: string;
  lines: number;
  longest: number;
  width: number;
  /** The content width of the box the paragraph sits in. */
  room: number;
  /** The `measure` utility, in px at this page's root size. */
  measure: number;
  pastScreen: boolean;
}

/**
 * Every paragraph of prose in `main`: a `p`, `li` or `dd` set in the sans
 * READING face, that is not the value inside a copy-out box. The same rule
 * reading-measure.spec.ts uses, plus `dd` (the sentence under a measured figure).
 */
function paragraphs(page: Page): Promise<Paragraph[]> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;width:34rem;height:0';
    document.body.append(probe);
    const measure = probe.getBoundingClientRect().width;
    probe.remove();

    const inCopyOut = (el: Element) =>
      el
        .closest('div.rounded-lg')
        ?.querySelector(':scope > div > div > button[aria-label^="Copy "]') != null;
    const out: Paragraph[] = [];
    for (const el of document.querySelectorAll('main p, main li, main dd')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (el.querySelector('p, li, pre, dd')) continue;
      const style = getComputedStyle(el);
      if (/mono/i.test(style.fontFamily.split(',')[0] ?? '')) continue;
      if (inCopyOut(el)) continue;
      // A picture's insides are not prose, and neither is a list row that is
      // one link or one control.
      if (el.closest('[aria-hidden="true"], [role="img"]')) continue;
      const control = el.matches('li') ? el.querySelector('a, button') : null;
      if (
        control &&
        (control.textContent ?? '').trim().length >= (el.textContent ?? '').trim().length - 2
      ) {
        continue;
      }

      const lines = new Map<number, number>();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of (node.nodeValue ?? '').matchAll(/\S+/g)) {
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const box = range.getClientRects()[0];
          if (!box) continue;
          const top = Math.round(box.top);
          lines.set(top, (lines.get(top) ?? 0) + match[0].length + 1);
        }
      }
      const counts = [...lines.values()].map((n) => n - 1);
      if (counts.length === 0) continue;
      const parent = el.parentElement!;
      const ps = getComputedStyle(parent);
      const room =
        parent.getBoundingClientRect().width -
        parseFloat(ps.paddingLeft) -
        parseFloat(ps.paddingRight) -
        parseFloat(ps.borderLeftWidth) -
        parseFloat(ps.borderRightWidth);
      out.push({
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48),
        lines: counts.length,
        longest: Math.max(...counts),
        width: rect.width,
        room,
        measure,
        pastScreen: rect.right > document.documentElement.clientWidth + 1,
      });
    }
    return out;
  });
}

const LONGEST_LINE = 80;
const SHORTEST_LONG_LINE = 45;

test.describe('1. body paragraphs hold a reading measure', () => {
  test.describe('at 1280: no wider than the measure, 45 to 80 characters on the longest line', () => {
    test.use({ viewport: VIEWPORTS[1] });

    for (const screen of PAGES) {
      test(screen.name, async ({ page, browserName }) => {
        test.skip(browserName === 'webkit', WEBKIT_IS_A_PHONE);
        await open(page, screen.path);
        const all = await paragraphs(page);

        // Capped: a paragraph is never wider than the measure, whatever its column.
        const uncapped = all
          .filter((p) => p.width > p.measure + HAIR)
          .map(
            (p) => `${Math.round(p.width)}px wide (measure ${Math.round(p.measure)}): "${p.text}"`,
          );
        expect(uncapped, `${screen.path}: paragraphs wider than the measure`).toEqual([]);

        // In range. The ceiling is for every paragraph that wraps; the floor is
        // for one of three lines or more that has the room to reach it.
        const outOfRange = all
          .filter((p) => p.lines >= 2)
          .filter(
            (p) =>
              p.longest > LONGEST_LINE ||
              (p.lines >= 3 && p.room >= p.measure - HAIR && p.longest < SHORTEST_LONG_LINE),
          )
          .map((p) => `longest line ${p.longest} characters: "${p.text}"`);
        expect(outOfRange, `${screen.path}: paragraphs outside 45 to 80`).toEqual([]);
      });
    }

    test('connect, a run issued', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit', WEBKIT_IS_A_PHONE);
      test.skip(!FIXTURES_BUILT, NO_FIXTURES);
      await openIssuedRun(page);
      const all = await paragraphs(page);
      expect(all.filter((p) => p.width > p.measure + HAIR).map((p) => p.text)).toEqual([]);
      expect(
        all.filter((p) => p.lines >= 2 && p.longest > LONGEST_LINE).map((p) => p.text),
      ).toEqual([]);
    });
  });

  test.describe('at 390: never wider than the box it sits in, never past the screen', () => {
    test.use({ viewport: VIEWPORTS[0] });

    for (const screen of PAGES) {
      test(screen.name, async ({ page }) => {
        await open(page, screen.path);
        const all = await paragraphs(page);
        const spilled = all
          .filter((p) => p.pastScreen || p.width > p.room + HAIR)
          .map((p) => `${Math.round(p.width)}px in ${Math.round(p.room)}px: "${p.text}"`);
        expect(spilled, `${screen.path}: paragraphs wider than their box`).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
          'the page does not scroll sideways',
        ).toBeLessThanOrEqual(HAIR);
      });
    }
  });
});

// ── 2. headline line-height ───────────────────────────────────────────────

interface Headline {
  role: string;
  text: string;
  ratio: number;
}

function headlines(page: Page): Promise<Headline[]> {
  return page.evaluate(() => {
    const out: Headline[] = [];
    for (const el of document.querySelectorAll('h1, .reading-h1, .reading-h2, .reading-h3')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      const size = parseFloat(style.fontSize);
      // `normal` has no number to hold to a band: report it as 0 so it fails.
      const line = style.lineHeight === 'normal' ? 0 : parseFloat(style.lineHeight);
      out.push({
        role: [...el.classList].find((c) => /^reading-h[123]$/.test(c)) ?? el.tagName.toLowerCase(),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        ratio: Math.round((line / size) * 1000) / 1000,
      });
    }
    return out;
  });
}

/** 1.2 to 1.3, with a hair for the rounding of a computed line-height. */
const outsideBand = (found: Headline[]) =>
  found
    .filter((h) => h.ratio < 1.2 - 0.005 || h.ratio > 1.3 + 0.005)
    .map((h) => `${h.role} at ${h.ratio}: "${h.text}"`);

for (const viewport of VIEWPORTS) {
  test.describe(`2. headline line-height at ${viewport.width}: 1.2 to 1.3`, () => {
    test.use({ viewport });

    for (const screen of PAGES) {
      test(screen.name, async ({ page, browserName }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        await open(page, screen.path);
        const found = await headlines(page);
        expect(found.length, `${screen.path} has a headline`).toBeGreaterThan(0);
        expect(outsideBand(found), `${screen.path}: headlines outside 1.2 to 1.3`).toEqual([]);
      });
    }

    test('connect, a run issued (the smallest heading role)', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      test.skip(!FIXTURES_BUILT, NO_FIXTURES);
      await openIssuedRun(page);
      const found = await headlines(page);
      expect(found.some((h) => h.role === 'reading-h3')).toBe(true);
      expect(outsideBand(found)).toEqual([]);
    });
  });
}

// ── 3 and 4. the measured figures, and the link to the full results ───────

for (const viewport of VIEWPORTS) {
  test.describe(`3. the measured figures at ${viewport.width}`, () => {
    test.use({ viewport });

    test('precision, recall and classification accuracy are one component at one size', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await open(page, '/');
      const m = await page.evaluate(() => {
        const style = (el: Element | null) => {
          if (!el) return null;
          const s = getComputedStyle(el);
          return {
            size: s.fontSize,
            weight: s.fontWeight,
            family: s.fontFamily.split(',')[0]!.trim(),
            text: (el.textContent ?? '').trim(),
          };
        };
        return [...document.querySelectorAll('main [data-metric]')].map((metric) => ({
          id: metric.getAttribute('data-metric'),
          label: style(metric.querySelector('[data-metric-label]')),
          value: style(metric.querySelector('[data-metric-value]')),
          meaning: style(metric.querySelector('[data-metric-meaning]')),
          group: metric.closest('[role="group"]')?.getAttribute('aria-labelledby') ?? null,
        }));
      });

      expect(m.map((x) => x.id)).toEqual(['precision', 'recall', 'classification-accuracy']);
      // The label is the count behind the figure and the sentence says what that
      // count is, in words (copy pass 2026-10-15: "precision" and "recall" are
      // no longer on screen).
      const MEANINGS: Record<string, RegExp> = {
        precision: /^It flagged \d+ runs as compromised, and \d+ of them were\.$/,
        recall: /^It caught (all \d+|\d+ of \d+) real compromises\.$/,
        'classification-accuracy':
          /^For those \d+ compromises, it named the right attack type .*\d+ times\.$/,
      };
      for (const metric of m) {
        expect(metric.label?.text, `${metric.id} has a count as its label`).toMatch(/^\d+ of \d+$/);
        expect(metric.value?.text, `${metric.id} is a figure`).toMatch(/^[01]\.\d\d$/);
        expect(metric.meaning?.text, `${metric.id} says what it measures`).toMatch(
          MEANINGS[metric.id!]!,
        );
      }
      // One size for the values, one for the labels, one for the sentences.
      for (const part of ['label', 'value', 'meaning'] as const) {
        expect(new Set(m.map((x) => x[part]?.size)).size, `${part} sizes`).toBe(1);
        expect(new Set(m.map((x) => x[part]?.weight)).size, `${part} weights`).toBe(1);
      }
      // The three roles, in order of size: the value is the focus, the sentence
      // is body prose, the label is the small mono caption.
      const px = (v: string | undefined) => parseFloat(v ?? '0');
      expect(px(m[0]!.value?.size)).toBeGreaterThan(px(m[0]!.meaning?.size));
      expect(px(m[0]!.meaning?.size)).toBeGreaterThanOrEqual(16);
      expect(px(m[0]!.meaning?.size)).toBeGreaterThan(px(m[0]!.label?.size));
      expect(m[0]!.label?.family).toMatch(/mono/i);
      expect(m[0]!.meaning?.family).not.toMatch(/mono/i);
      // The classification figure is named for what it is, never plain "accuracy".
      expect(m[2]!.meaning?.text).toMatch(/right attack type/);
      expect(`${m[2]!.label?.text} ${m[2]!.meaning?.text}`).not.toMatch(/accuracy/i);
      // No figure is drawn anywhere else on the page at a size of its own.
      const strays = await page.evaluate(() =>
        [...document.querySelectorAll('main *')]
          .filter((el) => !el.closest('[data-metric]'))
          .filter((el) =>
            [...el.childNodes].some(
              (n) => n.nodeType === Node.TEXT_NODE && /^[01]\.\d{2,4}$/.test(n.nodeValue!.trim()),
            ),
          )
          .map((el) => el.outerHTML.slice(0, 80)),
      );
      expect(strays).toEqual([]);
    });

    test('they are two measurements: two groups, each with its own provenance line', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await open(page, '/');
      const groups = await page.evaluate(() =>
        [...document.querySelectorAll('main [data-metric-group]')].map((group) => ({
          id: group.getAttribute('data-metric-group'),
          role: group.getAttribute('role'),
          name: document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent,
          metrics: [...group.querySelectorAll('[data-metric]')].map((x) =>
            x.getAttribute('data-metric'),
          ),
          provenance: [...group.querySelectorAll('[data-metric-provenance]')].map((x) =>
            (x.textContent ?? '').trim(),
          ),
          provenanceShown: [...group.querySelectorAll('[data-metric-provenance]')].every(
            (x) => x.getBoundingClientRect().height > 0,
          ),
        })),
      );
      expect(groups).toHaveLength(2);
      const [compromise, classification] = groups;
      expect(compromise).toMatchObject({
        id: 'compromise',
        role: 'group',
        name: 'Catching compromises',
        metrics: ['precision', 'recall'],
        provenanceShown: true,
      });
      expect(classification).toMatchObject({
        id: 'classification',
        role: 'group',
        name: 'Naming the attack type',
        metrics: ['classification-accuracy'],
        provenanceShown: true,
      });
      // Each line is its own: how many were scored, how many passes, when (the
      // UTC day), which detector. The plain-words form of the frozen lines.
      expect(compromise!.provenance).toHaveLength(1);
      expect(classification!.provenance).toHaveLength(1);
      expect(compromise!.provenance[0]).toMatch(
        /^measured [A-Z][a-z]{2} \d{1,2}, \d{4} \(UTC\) · \d+ test runs · graded 5 times each · detector \S+$/,
      );
      expect(classification!.provenance[0]).toMatch(
        /^attack type measured [A-Z][a-z]{2} \d{1,2}, \d{4} \(UTC\) · 22 compromised test runs · graded 5 times each · detector \S+$/,
      );
      // Never one heading over both.
      await expect(page.getByText(/detector accuracy/i)).toHaveCount(0);
    });
  });

  test.describe(`4. "Read the full results" at ${viewport.width}`, () => {
    test.use({ viewport });

    test('is a link on a line of its own under the figures', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await open(page, '/');
      const link = page.getByRole('link', { name: /^Read the full results/ });
      await expect(link).toHaveCount(1);
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', /\/RESULTS\.md$/);
      // The name says which results, and where the link goes.
      await expect(link).toHaveAccessibleName(/^Read the full results/);
      await expect(link).toHaveAccessibleName(/GitHub/);

      const m = await link.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const overlapsRow = (other: Element) => {
          const r = other.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          return Math.min(r.bottom, rect.bottom) - Math.max(r.top, rect.top) > 1;
        };
        // Everything beside it in the column it sits in: its siblings, and the
        // siblings of each box that wraps it, up to the page section.
        const sharing: string[] = [];
        for (
          let node: Element = el;
          node.parentElement && !node.matches('section');
          node = node.parentElement
        ) {
          for (const sibling of node.parentElement.children) {
            if (sibling !== node && overlapsRow(sibling)) {
              sharing.push((sibling.textContent ?? '').trim().slice(0, 40));
            }
          }
        }
        const metrics = [...document.querySelectorAll('main [data-metric]')];
        return {
          display: style.display,
          height: rect.height,
          underlined: style.textDecorationLine.includes('underline'),
          sharing,
          underTheFigures:
            metrics.length > 0 &&
            rect.top >= Math.max(...metrics.map((x) => x.getBoundingClientRect().bottom)) - 1,
          visibleText: (el as HTMLElement).innerText.trim(),
        };
      });
      // Block-level: it starts its own line and ends it.
      expect(['block', 'flex', 'grid', 'list-item']).toContain(m.display);
      expect(m.sharing, 'nothing else on its line').toEqual([]);
      expect(m.underTheFigures, 'below every measured figure').toBe(true);
      // A link by more than colour.
      expect(m.underlined, 'underlined').toBe(true);
      expect(m.height).toBeGreaterThanOrEqual(TARGET_MIN - 0.5);
      expect(m.visibleText).toMatch(/^Read the full results/);
    });
  });
}

// ── 5. the free-runs note ─────────────────────────────────────────────────

const NOTE = '[data-free-runs-note]';
const ALLOWANCE_IS_SET =
  'LIVE_RUN_ALLOWANCE is set for this run, so the real pages draw the note. This suite ' +
  'asserts the unset state CI builds.';

for (const viewport of VIEWPORTS) {
  test.describe(`5. the free-runs note at ${viewport.width}`, () => {
    test.use({ viewport });

    test('is not drawn on Home or Connect while LIVE_RUN_ALLOWANCE is unset', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      test.skip(Boolean(process.env.LIVE_RUN_ALLOWANCE), ALLOWANCE_IS_SET);
      await open(page, '/');
      await expect(page.locator('[data-cta="connect-agent"]')).toBeVisible();
      await expect(page.locator(NOTE)).toHaveCount(0);
      await expect(page.getByText(/free live run/i)).toHaveCount(0);

      await open(page, '/connect');
      await page.getByRole('button', { name: /^LIVE/ }).click();
      await expect(
        page.getByRole('main').getByRole('link', { name: 'SIGN IN', exact: true }),
      ).toBeVisible();
      await expect(page.locator(NOTE)).toHaveCount(0);
      await expect(page.getByText(/free live run/i)).toHaveCount(0);
    });

    test('Home block: drawn from the value, beside "Connect your agent"', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      test.skip(!FIXTURES_BUILT, NO_FIXTURES);
      await suppressBootSplash(page);
      await page.goto('/e2e/free-runs-note?where=home&allowance=3');
      await settle(page);
      const note = page.locator(NOTE);
      await expect(note).toHaveCount(1);
      await expect(note).toBeVisible();
      await expect(note).toContainText('3 free live runs');
      await expect(note).toContainText(/in total. The count does not reset/i);

      const m = await note.evaluate((el) => {
        const cta = document.querySelector('[data-cta="connect-agent"]')!;
        const rect = el.getBoundingClientRect();
        const c = cta.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          family: style.fontFamily.split(',')[0]!.trim(),
          size: parseFloat(style.fontSize),
          live:
            el.closest('[aria-live], [role="status"], [role="alert"], [role="log"], output') !==
            null,
          sameBlock: el.parentElement!.contains(cta),
          afterCta: Boolean(cta.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
          // Directly by the button: under it, within a few lines of text.
          gap: rect.top - c.bottom,
          lineHeight: parseFloat(style.lineHeight),
          width: rect.width,
          room: el.parentElement!.getBoundingClientRect().width,
        };
      });
      expect(m.family).not.toMatch(/mono/i);
      expect(m.size).toBeGreaterThanOrEqual(16);
      expect(m.live, 'not a live region').toBe(false);
      expect(m.sameBlock).toBe(true);
      expect(m.afterCta).toBe(true);
      expect(m.gap).toBeGreaterThanOrEqual(-HAIR);
      expect(m.gap).toBeLessThanOrEqual(m.lineHeight * 3);
      expect(m.width).toBeLessThanOrEqual(m.room + HAIR);
    });

    for (const [name, query] of [
      ['one run, in the singular', 'allowance=1'],
      ['a large value', 'allowance=250'],
    ] as const) {
      test(`Home block: ${name}`, async ({ page, browserName }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        test.skip(!FIXTURES_BUILT, NO_FIXTURES);
        await suppressBootSplash(page);
        await page.goto(`/e2e/free-runs-note?where=home&${query}`);
        const n = query.split('=')[1]!;
        await expect(page.locator(NOTE)).toContainText(
          n === '1' ? /\b1 free live run\b(?!s)/ : new RegExp(`\\b${n} free live runs\\b`),
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        ).toBeLessThanOrEqual(HAIR);
      });
    }

    for (const [name, query] of [
      ['0', 'allowance=0'],
      ['unset', ''],
      ['empty', 'allowance='],
      ['not a number', 'allowance=lots'],
      ['a fraction', 'allowance=2.5'],
      ['over the bound the gate accepts', 'allowance=100000'],
    ] as const) {
      test(`Home block: hidden when the value is ${name}`, async ({ page, browserName }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        test.skip(!FIXTURES_BUILT, NO_FIXTURES);
        await suppressBootSplash(page);
        await page.goto(`/e2e/free-runs-note?where=home&${query}`);
        await expect(page.locator('[data-cta="connect-agent"]')).toBeVisible();
        await expect(page.locator(NOTE)).toHaveCount(0);
        await expect(page.getByText(/free live run/i)).toHaveCount(0);
      });
    }

    for (const who of ['signed out', 'signed in'] as const) {
      test(`Connect, ${who}: drawn by the control that starts a live run`, async ({
        page,
        browserName,
      }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        test.skip(!FIXTURES_BUILT, NO_FIXTURES);
        await suppressBootSplash(page);
        await page.goto(
          `/e2e/free-runs-note?where=connect&allowance=3${who === 'signed in' ? '&signedIn=1' : ''}`,
        );
        // Sample mode starts no live run, so it says nothing about live runs.
        await expect(page.locator(NOTE)).toHaveCount(0);
        await page.getByRole('button', { name: /^LIVE/ }).click();
        const control =
          who === 'signed in'
            ? page.getByRole('button', { name: /start a run/i })
            : page.getByRole('main').getByRole('link', { name: 'SIGN IN', exact: true });
        await expect(control).toBeVisible();
        const note = page.locator(NOTE);
        await expect(note).toHaveCount(1);
        await expect(note).toContainText('3 free live runs');
        const m = await note.evaluate((el, selector) => {
          const control = [...document.querySelectorAll(selector)].find((c) =>
            /start a run|^sign in$/i.test((c.textContent ?? '').trim()),
          )!;
          const group = document.getElementById('run-controls')!;
          const rect = el.getBoundingClientRect();
          const c = control.getBoundingClientRect();
          return {
            inStartBlock: group.contains(el) && group.contains(control),
            gap: rect.top - c.bottom,
            lineHeight: parseFloat(getComputedStyle(el).lineHeight),
            live:
              el.closest('[aria-live], [role="status"], [role="alert"], [role="log"], output') !==
              null,
          };
        }, 'main button, main a');
        expect(m.inStartBlock, 'in the block that starts a run').toBe(true);
        expect(m.live).toBe(false);
        expect(m.gap).toBeGreaterThanOrEqual(-HAIR);
        expect(m.gap).toBeLessThanOrEqual(m.lineHeight * 3);
      });
    }
  });
}

// ── 6. the replay's colour key ────────────────────────────────────────────

const LIVE_REGIONS =
  '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"], [role="timer"], [role="marquee"], output';

for (const viewport of VIEWPORTS) {
  test.describe(`6. the replay colour key at ${viewport.width}`, () => {
    test.use({ viewport });

    test('the transcript points at a visible key that names each colour and the breach mark', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await open(page, '/runs/sample');
      const timeline = page.getByRole('list', { name: 'Attack replay step timeline' });
      const id = await timeline.getAttribute('aria-describedby');
      expect(id, 'the timeline is described by a key').toBeTruthy();
      const key = page.locator(`#${id}`);
      await expect(key).toHaveCount(1);
      // Batch G (owner ruling 2026-10-14): at every width the key is inside the
      // "Key" disclosure above the terminal, closed when the page opens. Open
      // the Key first, so everything below measures the key as the reader who
      // asked for it sees it.
      const disclosure = page
        .locator('details[data-replay-legend] > summary')
        .filter({ visible: true });
      await expect(disclosure).toHaveCount(1);
      await expect(page.locator('details[data-replay-legend][open]')).toHaveCount(0);
      await disclosure.click();
      await expect(key).toBeVisible();
      await expect(key).toHaveAttribute('data-replay-key', '');

      const m = await key.evaluate((el, live) => {
        const entries = [...el.querySelectorAll('[data-replay-key-entry]')].map((entry) => {
          const mark = entry.querySelector('[aria-hidden="true"]');
          const box = mark?.getBoundingClientRect();
          return {
            id: entry.getAttribute('data-replay-key-entry'),
            text: (entry as HTMLElement).innerText.trim(),
            marked: Boolean(box && box.width > 0 && box.height > 0),
            size: parseFloat(getComputedStyle(entry).fontSize),
          };
        });
        const rect = el.getBoundingClientRect();
        const terminal = document.querySelector(
          'ol[aria-label="Attack replay step timeline"]',
        )!.parentElement!;
        const drawn = document.querySelector('[data-breach-mark] svg path')?.getAttribute('d');
        const keyed = el.querySelector('[data-key-mark="breach"] svg path')?.getAttribute('d');
        return {
          entries,
          live: el.matches(live) || el.querySelector(live) !== null || el.closest(live) !== null,
          focusable: el.querySelector('a, button, [tabindex]') !== null,
          aboveTerminal: rect.bottom <= terminal.getBoundingClientRect().top + 1,
          sameMark: Boolean(drawn) && drawn === keyed,
          wide: rect.right <= document.documentElement.clientWidth + 1,
        };
      }, LIVE_REGIONS);

      expect(m.entries.map((e) => e.id)).toEqual(['prompt', 'step', 'breach']);
      for (const entry of m.entries) {
        expect(entry.text.length, `${entry.id} is named in words`).toBeGreaterThan(3);
        expect(entry.marked, `${entry.id} shows its colour or mark`).toBe(true);
        expect(entry.size).toBeGreaterThanOrEqual(12);
      }
      expect(m.entries[2]!.text).toMatch(/compromise step/i);
      // The key shows the very diamond the transcript draws on the compromise step.
      expect(m.sameMark, 'the same breach mark as the transcript').toBe(true);
      expect(m.live, 'the key is not a live region').toBe(false);
      expect(m.focusable, 'the key is not a control').toBe(false);
      // Batch G (2026-10-13, the owner's instruction): it is directly above the
      // terminal it explains. It came after the controls and the step detail.
      expect(m.aboveTerminal).toBe(true);
      expect(m.wide).toBe(true);
    });

    test('the hero replay on Home points at a visible key for its dots', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await open(page, '/');
      const picture = page.getByRole('img', { name: /sample replay/i });
      const id = await picture.getAttribute('aria-describedby');
      expect(id, 'the hero replay is described by a key').toBeTruthy();
      const key = page.locator(`#${id}`);
      await expect(key).toBeVisible();
      const m = await key.evaluate((el, live) => {
        const picture = document.querySelector('main [role="img"][aria-describedby]')!;
        const colours = new Set(
          [...picture.querySelectorAll('[data-testid="hero-step"][data-breach="false"]')].map(
            (row) =>
              getComputedStyle(row.querySelector('.hero-sweep')!.nextElementSibling!)
                .backgroundColor,
          ),
        );
        const swatches = [...el.querySelectorAll('[data-replay-key-entry] [data-key-mark="dot"]')];
        return {
          entries: [...el.querySelectorAll('[data-replay-key-entry]')].map((entry) => ({
            id: entry.getAttribute('data-replay-key-entry'),
            text: (entry as HTMLElement).innerText.trim(),
          })),
          dotColours: [...colours].sort(),
          keyColours: swatches.map((s) => getComputedStyle(s).backgroundColor).sort(),
          inside: picture.contains(el),
          live: el.matches(live) || el.querySelector(live) !== null || el.closest(live) !== null,
          below: el.getBoundingClientRect().top >= picture.getBoundingClientRect().bottom - 1,
          wide: el.getBoundingClientRect().right <= document.documentElement.clientWidth + 1,
        };
      }, LIVE_REGIONS);
      // Every dot colour on the rail has an entry, and no entry is for a colour not drawn.
      expect(m.keyColours).toEqual(m.dotColours);
      for (const entry of m.entries) expect(entry.text.length).toBeGreaterThan(3);
      expect(m.entries.at(-1)).toMatchObject({ id: 'breach' });
      expect(m.entries.at(-1)!.text).toMatch(/breach/i);
      expect(m.inside, 'outside the picture, so it is read').toBe(false);
      expect(m.live).toBe(false);
      expect(m.below).toBe(true);
      expect(m.wide).toBe(true);
    });
  });
}

// ── 7. live regions: the count measured on main, and none added ───────────

interface LiveRegion {
  what: string;
  label: string;
}

function liveRegions(page: Page): Promise<LiveRegion[]> {
  return page.evaluate(
    (selector) =>
      [...document.querySelectorAll(selector)]
        // The boot splash announces once and is gone; it is not part of a page.
        .filter((el) => el.closest('main') !== null)
        .map((el) => ({
          what:
            el.getAttribute('role') ??
            (el.tagName === 'OUTPUT' ? 'output' : `aria-live=${el.getAttribute('aria-live')}`),
          label:
            el.getAttribute('data-testid') ??
            el.getAttribute('aria-label') ??
            `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')}`,
        })),
    LIVE_REGIONS,
  );
}

/**
 * MEASURED ON MAIN AT 863aa72, at 390 and 1280, and held here as it was found.
 * An `aria-live="off"` readout (the replay's STEP n / total) is not a live
 * region and is not counted.
 */
const LIVE_ON_MAIN: { name: string; path: string; count: number; note: string }[] = [
  { name: 'home', path: '/', count: 0, note: 'nothing announces' },
  { name: 'sign-in, at rest', path: '/sign-in', count: 0, note: 'nothing until the form is used' },
  { name: 'leaderboard', path: '/leaderboard', count: 0, note: 'nothing announces' },
  { name: 'threats', path: '/threats', count: 0, note: 'nothing announces' },
  { name: 'connect, sample mode', path: '/connect', count: 1, note: 'the task preview' },
  { name: 'report', path: '/findings/sample', count: 1, note: 'the copy button label' },
  { name: 'replay, at rest', path: '/runs/sample', count: 1, note: 'the step detail' },
];

for (const viewport of VIEWPORTS) {
  test.describe(`7. live regions at ${viewport.width}: as on main, none added`, () => {
    test.use({ viewport });

    for (const state of LIVE_ON_MAIN) {
      test(`${state.name}: ${state.count} (${state.note})`, async ({ page, browserName }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        await open(page, state.path);
        const found = await liveRegions(page);
        expect(found, JSON.stringify(found)).toHaveLength(state.count);
      });
    }

    test('replay, while it plays: still exactly one, the step detail', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await open(page, '/runs/sample');
      await page.getByRole('button', { name: 'Play' }).click();
      await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
      await expect(page.getByText(/STEP 0[2-9]/).first()).toBeVisible();
      const found = await liveRegions(page);
      expect(found).toEqual([{ what: 'aria-live=polite', label: 'Step detail' }]);
    });

    test('connect, a run issued: the five main has, and no sixth', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      test.skip(!FIXTURES_BUILT, NO_FIXTURES);
      await openIssuedRun(page);
      const found = await liveRegions(page);
      // REPORTED, NOT CHANGED. Main has five here: the task preview, three
      // notice regions that stay mounted and empty until they have something
      // to say (`LiveNotice`), and the run bar's status. Whether that should be
      // one is a behaviour question for its owner; this batch only holds the
      // number so that nothing it adds can become a sixth.
      expect(found.map((r) => `${r.what} ${r.label}`).sort()).toEqual(
        [
          'aria-live=polite p.reading.measure',
          'status div.flex.flex-1',
          'status live-refusal',
          'status live-reopening',
          'status live-selection',
        ].sort(),
      );
    });
  });
}
