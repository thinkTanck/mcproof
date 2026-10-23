import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';
import { TEXT_SPACING_OVERRIDE } from './support/text-spacing';

/**
 * PROVENANCE WRAP and PROVENANCE WRAP 2 (owner rulings 2026-10-21 and 22), in
 * a real browser.
 *
 *  - A model id never spans two lines, at any width including 320, and with
 *    the WCAG 1.4.12 text-spacing override on: every client rect of each
 *    `[data-model-id]` shares one top.
 *  - Each " · " segment of a measured provenance line is on one line wherever
 *    it fits the line (375, 1024 and 1280). One wider than the whole line may
 *    break inside itself, rather than be cut.
 *  - On the Home metric cards the detector segment starts a line of its own,
 *    and is line 2 wherever the rest of the line fits on one.
 *
 * Structure, not pixels: "one line" is client rects whose tops agree to within
 * half a line height.
 */
const MODEL_WIDTHS = [320, 375, 768, 1024, 1280] as const;
const SEGMENT_WIDTHS = [375, 1024, 1280] as const;
const FIXTURES_BUILT = process.env.E2E_FIXTURES === '1';

const PAGES = [
  { name: 'Home', path: '/' },
  { name: 'the sample replay', path: '/runs/sample' },
  { name: 'the sample report', path: '/findings/sample' },
  { name: 'the leaderboard fixture', path: '/e2e/leaderboard', fixture: true },
] as const;

async function open(page: Page, path: string, width: number, spacing = false) {
  await page.setViewportSize({ width, height: 900 });
  await suppressBootSplash(page);
  await page.goto(path);
  if (spacing) await page.addStyleTag({ content: TEXT_SPACING_OVERRIDE });
  await page.evaluate(() => document.fonts.ready);
}

/**
 * For each element matching `selector`: how many lines its text takes, and
 * whether it would fit on one line of the block it sits in.
 */
function linesOf(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const blockOf = (el: Element): HTMLElement => {
      let cur = el.parentElement!;
      while (
        cur.parentElement &&
        /^(inline|inline-block|contents)$/.test(getComputedStyle(cur).display)
      ) {
        cur = cur.parentElement;
      }
      return cur;
    };
    return [...document.querySelectorAll<HTMLElement>(sel)]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const half = parseFloat(getComputedStyle(el).lineHeight) / 2 || 8;
        const tops = [...range.getClientRects()]
          .filter((r) => r.width > 0)
          .map((r) => r.top)
          .sort((a, b) => a - b);
        const lines = tops.filter((top, i) => i === 0 || top - tops[i - 1]! > half).length;
        // Its width on one line, measured on a hidden copy beside it.
        const copy = el.cloneNode(true) as HTMLElement;
        Object.assign(copy.style, {
          position: 'absolute',
          visibility: 'hidden',
          whiteSpace: 'nowrap',
          display: 'inline-block',
          maxWidth: 'none',
        });
        el.parentElement!.appendChild(copy);
        const natural = copy.getBoundingClientRect().width;
        copy.remove();
        const block = blockOf(el);
        const cs = getComputedStyle(block);
        const line = block.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { text: el.textContent ?? '', lines, fits: natural <= line + 1 };
      });
  }, selector);
}

for (const width of MODEL_WIDTHS) {
  for (const spacing of [false, true]) {
    test.describe(`model ids at ${width}${spacing ? ', text spacing on' : ''}`, () => {
      for (const p of PAGES) {
        test(`${p.name}: no model id spans two lines`, async ({ page }) => {
          test.skip(
            'fixture' in p && !FIXTURES_BUILT,
            'E2E_FIXTURES=1 is unset, so the fixture is not built.',
          );
          await open(page, p.path, width, spacing);
          const ids = await linesOf(page, '[data-model-id]');
          expect(ids.length, 'a model id is on the page').toBeGreaterThan(0);
          for (const id of ids) expect(id.lines, id.text).toBe(1);
        });
      }
    });
  }
}

for (const width of SEGMENT_WIDTHS) {
  test.describe(`provenance segments at ${width}`, () => {
    for (const p of PAGES) {
      test(`${p.name}: each provenance segment is on one line wherever it fits`, async ({
        page,
      }) => {
        test.skip(
          'fixture' in p && !FIXTURES_BUILT,
          'E2E_FIXTURES=1 is unset, so the fixture is not built.',
        );
        await open(page, p.path, width);
        for (const s of await linesOf(page, '[data-provenance-segment]')) {
          if (s.fits) expect(s.lines, s.text).toBe(1);
        }
      });
    }
  });
}

for (const width of MODEL_WIDTHS) {
  test(`Home at ${width}: the detector segment starts a line of its own, line 2 where the rest fits`, async ({
    page,
  }) => {
    await open(page, '/', width);
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll('[data-metric-provenance]')].map((line) => {
        const segs = [...line.querySelectorAll<HTMLElement>('[data-provenance-segment]')];
        const box = (el: Element) => el.getBoundingClientRect();
        const detector = segs.find((s) => s.dataset.provenanceSegment === 'detector')!;
        const others = segs.filter((s) => s !== detector);
        const half = parseFloat(getComputedStyle(line).lineHeight) / 2 || 8;
        const othersBottom = Math.max(...others.map((s) => box(s).bottom));
        const othersTops = others.map((s) => box(s).top);
        const restOnOneLine = Math.max(...othersTops) - Math.min(...othersTops) < half;
        return {
          text: detector.textContent,
          startsOwnLine: box(detector).top >= othersBottom - 1,
          alone: others.every((s) => Math.abs(box(s).top - box(detector).top) >= half),
          restOnOneLine,
          lineTwo:
            restOnOneLine &&
            box(detector).top - Math.min(...othersTops) < 2.5 * half * 2 &&
            box(detector).top > Math.min(...othersTops) + half,
        };
      }),
    );
    expect(cards).toHaveLength(2);
    for (const c of cards) {
      expect(c.text).toBe('detector claude-haiku-4-5');
      expect(c.startsOwnLine, 'starts a line of its own').toBe(true);
      expect(c.alone, 'alone on its line').toBe(true);
      if (c.restOnOneLine) expect(c.lineTwo, 'line 2 where the rest fits').toBe(true);
    }
  });
}
