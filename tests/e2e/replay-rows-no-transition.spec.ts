import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * A TRANSCRIPT LINE IS DRAWN AT ITS FULL WIDTH AT ONCE, WITH MOTION REDUCED TOO.
 *
 * On a phone the replay terminal holds the height of the whole transcript with a
 * hidden copy of every line (ReplayTerminal). A line the playhead has not reached
 * is `sr-only`, which carries a margin of -1px; when the playhead reaches it the
 * class goes and the line takes the column's width.
 *
 * THE BUG THIS GUARDS. The reduced-motion reset gave every element a transition
 * 0.001ms long on every property. So with motion reduced, the line's margin did
 * not go from -1px to 0: it started a transition from -1px, and a transition
 * holds its start value until the browser's next frame begins it. Until then the
 * line was 2px wider than the copy holding its height, three lines of the sample
 * wrapped one line shorter than their copies, and the terminal kept about three
 * lines of empty room under its last line. WebKit sometimes left the transitions
 * pending long enough for a reader, and for
 * tests/e2e/phone-replay-layout.spec.ts, to see it.
 *
 * A late frame cannot be ordered from a test, so the test holds one: the moment
 * a line's class changes, every transition that has started on it is paused at
 * its first instant, which is exactly the state a late frame leaves. With no
 * transition on the line there is nothing to hold and nothing changes.
 *
 * Every comparison is one element against another, never a pixel count.
 */

const PHONES = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
] as const;

const RUNS = [
  { path: '/runs/sample', total: 8 },
  { path: '/runs/asi06-run', total: 13 },
] as const;

const LIST = 'ol[aria-label="Attack replay step timeline"]';

const stepText = (n: number) => `STEP ${String(n).padStart(2, '0')}`;

type Held = { held: string[] };

/**
 * From now on, whenever a transcript line's class changes, read its style (which
 * is what starts a transition), note every transition running on it and pause it
 * where it stands. The names collected are the properties that were in motion.
 */
async function holdTransitionsOnLines(page: Page) {
  await page.evaluate((listSelector) => {
    const w = window as unknown as Held;
    w.held = [];
    const list = document.querySelector(listSelector)!;
    new MutationObserver((records) => {
      for (const record of records) {
        const line = record.target as HTMLElement;
        if (line.tagName !== 'LI') continue;
        void getComputedStyle(line).marginLeft;
        for (const animation of line.getAnimations()) {
          w.held.push((animation as CSSTransition).transitionProperty ?? 'animation');
          animation.pause();
        }
      }
    }).observe(list, { attributes: true, attributeFilter: ['class'], subtree: true });
  }, LIST);
}

async function openAtTheEnd(page: Page, run: (typeof RUNS)[number]) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await suppressBootSplash(page);
  await page.goto(run.path);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await holdTransitionsOnLines(page);
  await page.getByRole('slider', { name: 'Scrub to step' }).focus();
  await page.keyboard.press('End');
  await expect(page.getByText(stepText(run.total))).toBeVisible();
  // The last line is complete and the terminal has finished scrolling to it.
  await expect(page.locator('button[aria-current="step"]')).toContainText('exit 0');
  let last = -1;
  await expect
    .poll(async () => {
      const now = await page.evaluate(
        (s) => document.querySelector(s)!.parentElement!.scrollTop,
        LIST,
      );
      const settled = now === last;
      last = now;
      return settled;
    })
    .toBe(true);
}

for (const vp of PHONES) {
  test.describe(`transcript lines with motion reduced at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    for (const run of RUNS) {
      test(`${run.path}: drawing a line starts no transition on it`, async ({ page }) => {
        await openAtTheEnd(page, run);
        const held = await page.evaluate(() => (window as unknown as Held).held);
        expect([...new Set(held)], 'properties in transition on a line as it was drawn').toEqual(
          [],
        );
      });

      test(`${run.path}: every line is as wide and as tall as the copy that holds its height, and no room is left under the last`, async ({
        page,
      }) => {
        await openAtTheEnd(page, run);
        const m = await page.evaluate((listSelector) => {
          const list = document.querySelector(listSelector)!;
          const terminal = list.parentElement!;
          const drawn = [...list.querySelectorAll('li')];
          const copies = [...terminal.querySelectorAll('[data-reserve-line]')];
          const t = terminal.getBoundingClientRect();
          const lineHeight = parseFloat(getComputedStyle(terminal).lineHeight);
          const rows = drawn.map((li, i) => {
            const a = li.getBoundingClientRect();
            const b = copies[i]!.getBoundingClientRect();
            return {
              step: i + 1,
              hidden: li.classList.contains('sr-only'),
              wider: a.width - b.width,
              taller: a.height - b.height,
            };
          });
          const lastBottom = drawn[drawn.length - 1]!.getBoundingClientRect().bottom;
          return {
            lines: drawn.length,
            copies: copies.length,
            hidden: rows.filter((r) => r.hidden).map((r) => r.step),
            offWidth: rows.filter((r) => Math.abs(r.wider) > 0.5),
            offHeight: rows.filter((r) => Math.abs(r.taller) > 0.5),
            listAgainstCopy:
              list.getBoundingClientRect().height -
              terminal.querySelector('[data-terminal-reserve]')!.getBoundingClientRect().height,
            room: (terminal.scrollHeight - (lastBottom - t.top + terminal.scrollTop)) / lineHeight,
          };
        }, LIST);

        expect(m.lines, 'one copy for every line').toBe(m.copies);
        expect(m.lines).toBe(run.total);
        expect(m.hidden, 'at the end every line is drawn').toEqual([]);
        expect(m.offWidth, 'lines not as wide as their copy').toEqual([]);
        expect(m.offHeight, 'lines not as tall as their copy').toEqual([]);
        expect(
          Math.abs(m.listAgainstCopy),
          'the transcript against the height held for it, in px',
        ).toBeLessThanOrEqual(0.5);
        expect(m.room, 'scrollable room after the last line, in lines').toBeLessThan(1);
      });
    }
  });
}
