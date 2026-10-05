import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE READING MEASURE, MEASURED IN A REAL BROWSER.
 *
 * Body paragraphs used to run as wide as their column. At 1280px that was up to
 * 128 characters on a line (the rationale on Findings), and the paragraphs that
 * did carry a cap carried `max-w-[68ch]`, which does not do what it says: `ch` is
 * the width of the digit zero, Geist's zero is much wider than its average
 * letter, and 68ch held about 97 characters. Prose now wraps at a fixed measure
 * that holds about 66 characters a line in either font.
 *
 * WHAT IS PROSE HERE: a `p` or `li` inside `main`, set in the sans READING face,
 * that is not the value inside a copy-out box. Mono text is telemetry (labels,
 * chips, readouts, code) and is not capped. The copy-out boxes, the code blocks
 * and the picker grid keep the full column, and prose keeps their left edge.
 *
 * TWO NUMBERS, because "characters per line" means two things. The typical line
 * (the mean of a paragraph's full lines) is what a measure is, and it has to be
 * at or under 75. A single line of narrow letters can run a little longer than
 * its neighbours at the same width, so the longest line gets a ceiling of 80.
 * A two-line paragraph has only one full line, so it is held to the ceiling
 * alone (one such line on /threats is 77 characters at the same width that
 * holds 66 on a typical line).
 *
 * Layout depends on computed styles and real font metrics, which jsdom has
 * neither of, so this runs in Chromium. It runs in the fallback font as well as
 * the default, because Geist loads with `display: 'optional'` and a first visit
 * can keep the fallback for the page's lifetime.
 */

const TYPICAL_LINE = 75;
const LONGEST_LINE = 80;

const SCREENS: { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  { name: 'sign-in', path: '/sign-in' },
  { name: 'connect', path: '/connect' },
  { name: 'replay', path: '/runs/sample' },
  { name: 'findings', path: '/findings/sample' },
  { name: 'findings, classification unreliable', path: '/findings/asi10-goal-drift' },
  { name: 'leaderboard', path: '/leaderboard' },
  { name: 'threats', path: '/threats' },
];

const FIXTURE = '/e2e/connect-states?state=waiting';

type Block = { text: string; typical: number; longest: number; lines: number };

/** Every prose block on the page, with its characters per rendered line. */
async function proseBlocks(page: Page): Promise<Block[]> {
  return page.evaluate(() => {
    const out: { text: string; typical: number; longest: number; lines: number }[] = [];
    // A copy-out box is the bordered box whose own header row holds a Copy control.
    const inCopyOut = (el: Element) =>
      el
        .closest('div.rounded-lg')
        ?.querySelector(':scope > div > div > button[aria-label^="Copy "]') != null;
    for (const el of document.querySelectorAll('main p, main li')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (el.querySelector('p, li, pre')) continue;
      if (/mono/i.test(getComputedStyle(el).fontFamily.split(',')[0] ?? '')) continue;
      if (inCopyOut(el)) continue;

      // Bucket each word by the top of its box: one bucket is one rendered line.
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
      if (counts.length < 2) continue; // one line cannot be too long for its measure
      const full = counts.slice(0, -1);
      out.push({
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48),
        // A mean needs more than one line to be a mean: a two-line paragraph has
        // one full line, so it is held to the longest-line ceiling alone.
        typical: full.length < 2 ? 0 : Math.round(full.reduce((a, n) => a + n, 0) / full.length),
        longest: Math.max(...counts),
        lines: counts.length,
      });
    }
    return out;
  });
}

const tooLong = (blocks: Block[]) =>
  blocks
    .filter((b) => b.typical > TYPICAL_LINE || b.longest > LONGEST_LINE)
    .map((b) => `typical ${b.typical}, longest ${b.longest}: "${b.text}"`);

test.use({ viewport: { width: 1280, height: 900 } });

for (const font of ['default', 'fallback'] as const) {
  test.describe(`reading measure at 1280px, ${font} font`, () => {
    test.beforeEach(async ({ context, page }) => {
      if (font === 'fallback') {
        await context.route(/\.woff2?(\?|$)/, (route) => route.abort());
      }
      await suppressBootSplash(page);
    });

    for (const screen of SCREENS) {
      test(`${screen.name}: body paragraphs wrap at about 75 characters or fewer`, async ({
        page,
      }) => {
        await page.goto(screen.path);
        await page.waitForLoadState('networkidle');

        expect(tooLong(await proseBlocks(page)), `${screen.path} prose over the measure`).toEqual(
          [],
        );
      });
    }
  });
}

test.describe('reading measure at 1280px, an issued live run', () => {
  test.skip(
    process.env.E2E_FIXTURES !== '1',
    'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this suite drives is not built.',
  );

  async function issuedRun(page: Page) {
    await suppressBootSplash(page);
    await page.goto(FIXTURE);
    await page.getByRole('button', { name: /^LIVE/ }).click();
    await page.getByRole('button', { name: /issue run endpoint/i }).click();
    await expect(page.getByRole('region', { name: /what we have actually seen/i })).toBeVisible();
    await page.getByRole('button', { name: /^claude code/i }).click();
    await page.waitForLoadState('networkidle');
  }

  test('body paragraphs wrap at about 75 characters or fewer', async ({ page }) => {
    await issuedRun(page);

    expect(tooLong(await proseBlocks(page)), 'prose over the measure').toEqual([]);
  });

  test('the copy-out boxes and the picker grid keep the full column, on the same left edge as prose', async ({
    page,
  }) => {
    await issuedRun(page);

    const m = await page.evaluate(() => {
      const round = (n: number) => Math.round(n);
      const column = document.querySelector('.panel-in')!.getBoundingClientRect();
      const boxOf = (name: string) =>
        document
          .querySelector(`button[aria-label="Copy ${name}"]`)!
          .closest('div.rounded-lg')!
          .getBoundingClientRect();
      const boxes = ['run endpoint', 'run token', 'task goal'].map((name) => {
        const r = boxOf(name);
        return { name, left: round(r.left), width: round(r.width) };
      });
      const grid = document
        .querySelector('[role="radiogroup"][aria-label^="Attack category"]')!
        .getBoundingClientRect();
      const endpoint = document.querySelector('section[aria-labelledby="connect-endpoint"]')!;
      const prose = [...endpoint.querySelectorAll(':scope > p')].map((p) => {
        const r = p.getBoundingClientRect();
        return { left: round(r.left), width: round(r.width) };
      });
      const serving = endpoint.querySelector(':scope > div.flex-wrap')!.getBoundingClientRect();
      return {
        column: { left: round(column.left), width: round(column.width) },
        boxes,
        grid: { left: round(grid.left), width: round(grid.width) },
        prose,
        servingLeft: round(serving.left),
      };
    });

    // Boxes and the picker grid: the whole column, never capped.
    for (const box of m.boxes) {
      expect(box, box.name).toEqual({ name: box.name, ...m.column });
    }
    expect(m.grid).toEqual(m.column);
    // Prose: narrower than the column, and starting where the boxes start.
    expect(m.prose.length).toBeGreaterThan(0);
    for (const p of m.prose) {
      expect(p.left).toBe(m.column.left);
      expect(p.width).toBeLessThan(m.column.width);
    }
    expect(m.servingLeft).toBe(m.column.left);
  });

  test('the task text inside its copy-out box is not capped', async ({ page }) => {
    await issuedRun(page);

    const m = await page.evaluate(() => {
      const box = document
        .querySelector('button[aria-label="Copy task goal"]')!
        .closest('div.rounded-lg')!;
      const value = box.querySelector(':scope > p')!;
      return {
        maxWidth: getComputedStyle(value).maxWidth,
        fills: Math.round(value.getBoundingClientRect().width) >= box.clientWidth - 40,
      };
    });

    expect(m).toEqual({ maxWidth: 'none', fills: true });
  });
});
