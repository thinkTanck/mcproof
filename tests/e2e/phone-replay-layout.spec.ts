import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE REPLAY ON A PHONE: THE STEP AND THE CONTROLS IN ONE VIEW (Part D).
 *
 * On a phone the replay stacked a fixed-height terminal, then the verdict
 * terminal, then the transport. Play sat two terminals down the page, and the
 * transcript kept half a terminal of empty room under its last line (the room
 * the desktop layout uses to hold the newest line at the middle).
 *
 * THE RULE, below 768px wide and on a phone held sideways:
 *   - the order is terminal, then the playback controls, then the verdict, in
 *     the DOCUMENT, so Tab and a screen reader meet them in the order they are
 *     seen;
 *   - the terminal and the controls fit one viewport under the header together,
 *     and the terminal scrolls INSIDE itself to keep the current step in view as
 *     playback advances, without moving the page;
 *   - no empty room is left under the transcript's last line;
 *   - nothing is pinned: the controls scroll with the page like everything else.
 *
 * "At the start" is the reader who has scrolled the stage into view: the cap is
 * one viewport under the header for the terminal and the controls, and the run's
 * own title block above them scrolls away like any page heading.
 *
 * All geometry here is relative (inside, before, a fraction of a line), never a
 * pixel count, because Linux CI draws fonts at other sizes than Windows does.
 */

const PHONES = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
] as const;

/** The sample (8 steps) and the longest sample trace (ASI06, 13 steps). */
const RUNS = [
  { path: '/runs/sample', total: 8 },
  { path: '/runs/asi06-run', total: 13 },
] as const;

async function open(page: Page, path: string) {
  await suppressBootSplash(page);
  await page.goto(path);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Scroll the page the way a reader does: until the terminal sits under the header. */
async function bringStageIntoView(page: Page) {
  await page.evaluate(() => {
    const list = document.querySelector('ol[aria-label="Attack replay step timeline"]')!;
    const terminal = list.parentElement!;
    const header = document.querySelector('header')!;
    const gap = 8;
    window.scrollTo(
      0,
      window.scrollY +
        terminal.getBoundingClientRect().top -
        header.getBoundingClientRect().bottom -
        gap,
    );
  });
}

type View = {
  headerBottom: number;
  viewportHeight: number;
  scrollY: number;
  terminal: { top: number; bottom: number; lineHeight: number; padBottom: number };
  current: { top: number; bottom: number } | null;
  last: { top: number; bottom: number } | null;
  play: { top: number; bottom: number } | null;
  sideways: number;
};

function view(page: Page): Promise<View> {
  return page.evaluate(() => {
    const list = document.querySelector('ol[aria-label="Attack replay step timeline"]')!;
    const terminal = list.parentElement!;
    const t = terminal.getBoundingClientRect();
    const ts = getComputedStyle(terminal);
    const box = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    const drawn = [...list.querySelectorAll('li')].filter(
      (li) => !li.classList.contains('sr-only'),
    );
    const play = [...document.querySelectorAll('button')].find((b) => {
      const name = b.getAttribute('aria-label');
      return (name === 'Play' || name === 'Pause') && b.getBoundingClientRect().width > 0;
    });
    return {
      headerBottom: document.querySelector('header')!.getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
      terminal: {
        top: t.top,
        bottom: t.bottom,
        lineHeight: parseFloat(ts.lineHeight),
        padBottom: parseFloat(ts.paddingBottom),
      },
      current: box(list.querySelector('button[aria-current="step"]')?.closest('li')),
      last: box(drawn[drawn.length - 1]),
      play: box(play),
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

/** Both the current line and Play/Pause are on screen, below the header. */
function expectStepAndControlsInView(v: View, label: string) {
  const slack = 1;
  expect(v.current, `${label}: a current line exists`).not.toBeNull();
  expect(v.play, `${label}: a Play/Pause control is drawn`).not.toBeNull();
  const cur = v.current!;
  const play = v.play!;
  // The current line is inside the terminal's visible box...
  expect(cur.top, `${label}: current line top inside the terminal`).toBeGreaterThanOrEqual(
    v.terminal.top - slack,
  );
  expect(cur.bottom, `${label}: current line bottom inside the terminal`).toBeLessThanOrEqual(
    v.terminal.bottom + slack,
  );
  // ...and both it and Play are inside the window, clear of the sticky header.
  for (const [name, r] of [
    ['current line', cur],
    ['Play/Pause', play],
  ] as const) {
    expect(r.top, `${label}: ${name} clears the header`).toBeGreaterThanOrEqual(
      v.headerBottom - slack,
    );
    expect(r.bottom, `${label}: ${name} is above the bottom of the window`).toBeLessThanOrEqual(
      v.viewportHeight + slack,
    );
  }
  expect(v.sideways, `${label}: no sideways scroll`).toBeLessThanOrEqual(0);
}

const stepText = (n: number) => `STEP ${String(n).padStart(2, '0')}`;

for (const vp of PHONES) {
  test.describe(`phone replay at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    for (const run of RUNS) {
      test(`${run.path}: the current step and Play stay in view at the start, middle and end, and the page never moves`, async ({
        page,
      }) => {
        await open(page, run.path);
        await bringStageIntoView(page);

        const start = await view(page);
        expectStepAndControlsInView(start, 'start');

        // Play at 2x and pause it in the middle. The playhead is read off the
        // scrubber, so a step that goes by between two looks is not missed.
        const slider = page.getByRole('slider', { name: 'Scrub to step' });
        await page.getByRole('button', { name: '2×' }).click();
        await page.getByRole('button', { name: 'Play' }).click();
        const middle = Math.ceil(run.total / 2);
        await expect
          .poll(async () => Number(await slider.inputValue()), { timeout: 15_000 })
          .toBeGreaterThanOrEqual(middle - 1);
        await page.getByRole('button', { name: 'Pause' }).click();
        await expect
          .poll(async () => {
            const v = await view(page);
            return v.current !== null && v.current.bottom <= v.terminal.bottom + 1;
          })
          .toBe(true);
        expectStepAndControlsInView(await view(page), 'middle');

        // Play on to the end.
        await page.getByRole('button', { name: 'Play' }).click();
        await expect(page.getByText(stepText(run.total))).toBeVisible({ timeout: 20_000 });
        await expect
          .poll(async () => {
            const v = await view(page);
            return v.current !== null && v.current.bottom <= v.terminal.bottom + 1;
          })
          .toBe(true);
        const end = await view(page);
        expectStepAndControlsInView(end, 'end');

        // Following the step scrolled the TERMINAL, never the page.
        expect(
          Math.abs(end.scrollY - start.scrollY),
          'the page did not scroll',
        ).toBeLessThanOrEqual(1);
      });
    }

    test('no empty room under the last line at the end of the run', async ({ page }) => {
      // Reduced motion: the last line is complete the moment it is reached, so
      // what is measured is the finished transcript, not one still typing.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, '/runs/sample');
      await page.getByRole('slider', { name: 'Scrub to step' }).focus();
      await page.keyboard.press('End');
      await expect(page.getByText(stepText(8))).toBeVisible();
      // Let the last line finish typing and the terminal finish scrolling.
      await expect(page.locator('button[aria-current="step"]')).toContainText('exit 0');
      let last = -1;
      await expect
        .poll(async () => {
          const now = await page.evaluate(
            () =>
              document.querySelector('ol[aria-label="Attack replay step timeline"]')!.parentElement!
                .scrollTop,
          );
          const settled = now === last;
          last = now;
          return settled;
        })
        .toBe(true);

      const room = await page.evaluate(() => {
        const list = document.querySelector('ol[aria-label="Attack replay step timeline"]')!;
        const terminal = list.parentElement!;
        const lines = [...list.querySelectorAll('li')].filter(
          (li) => !li.classList.contains('sr-only'),
        );
        const t = terminal.getBoundingClientRect();
        const lastBottom = lines[lines.length - 1]!.getBoundingClientRect().bottom;
        const lineHeight = parseFloat(getComputedStyle(terminal).lineHeight);
        return {
          // Scrollable content left after the last line (bottom padding included).
          content: (terminal.scrollHeight - (lastBottom - t.top + terminal.scrollTop)) / lineHeight,
          // Visible room between the last line and the terminal's bottom edge.
          visible: (t.bottom - lastBottom) / lineHeight,
        };
      });
      // In lines. The terminal's own bottom padding is less than one line.
      expect(room.content, 'scrollable room after the last line, in lines').toBeLessThan(1);
      expect(room.visible, 'visible room under the last line, in lines').toBeLessThan(1);
    });

    test('scrubbing back to the start brings the first line back into the terminal', async ({
      page,
    }) => {
      await open(page, '/runs/asi06-run');
      await bringStageIntoView(page);
      const slider = page.getByRole('slider', { name: 'Scrub to step' });
      await slider.focus();
      await page.keyboard.press('End');
      await expect(page.getByText(stepText(13))).toBeVisible();
      await page.keyboard.press('Home');
      await expect(page.getByText(stepText(1))).toBeVisible();
      await expect
        .poll(async () => {
          const v = await view(page);
          return v.current !== null && v.current.top >= v.terminal.top - 1;
        })
        .toBe(true);
      expectStepAndControlsInView(await view(page), 'back at the start');
    });

    test('the document order is terminal, then the controls, then the verdict, and Tab follows it', async ({
      page,
    }) => {
      await open(page, '/runs/sample');

      const order = await page.evaluate(() => {
        const list = document.querySelector('ol[aria-label="Attack replay step timeline"]')!;
        const play = [...document.querySelectorAll('button[aria-label="Play"]')].find(
          (b) => b.getBoundingClientRect().width > 0,
        )!;
        const verdict = document.querySelector('aside[aria-label="Detector verdict"]')!;
        const follows = (a: Node, b: Node) =>
          (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        const r = (el: Element) => el.getBoundingClientRect();
        return {
          domPlayAfterTerminal: follows(list, play),
          domVerdictAfterPlay: follows(play, verdict),
          seenPlayBelowTerminal: r(play).top >= r(list.parentElement!).bottom - 1,
          seenVerdictBelowPlay: r(verdict).top >= r(play).bottom - 1,
        };
      });
      expect(order).toEqual({
        domPlayAfterTerminal: true,
        domVerdictAfterPlay: true,
        seenPlayBelowTerminal: true,
        seenVerdictBelowPlay: true,
      });

      // Walk with Tab from the skip link and name the region of every stop.
      await page.getByRole('link', { name: 'Skip to content' }).focus();
      const regions: string[] = [];
      for (let i = 0; i < 40; i += 1) {
        await page.keyboard.press('Tab');
        const region = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          if (el.closest('ol[aria-label="Attack replay step timeline"]')) return 'terminal';
          if (el.closest('aside[aria-label="Detector verdict"]')) return 'verdict';
          // The transport is the box whose own children include RESET.
          if (el.closest('div:has(> button[aria-label="Restart"])')) return 'controls';
          return 'other';
        });
        if (regions[regions.length - 1] !== region) regions.push(region);
        if (region === 'verdict') break;
      }
      expect(regions.filter((r) => r !== 'other')).toEqual(['terminal', 'controls', 'verdict']);
    });

    test('the controls are not pinned: they scroll with the page', async ({ page }) => {
      await open(page, '/runs/sample');
      const positions = await page.evaluate(() => {
        const play = [...document.querySelectorAll('button[aria-label="Play"]')].find(
          (b) => b.getBoundingClientRect().width > 0,
        )!;
        const pinned: string[] = [];
        for (let el: Element | null = play; el; el = el.parentElement) {
          const p = getComputedStyle(el).position;
          if (p === 'fixed' || p === 'sticky') pinned.push(el.tagName);
        }
        return pinned;
      });
      expect(positions).toEqual([]);
    });

    test('playback never grows the terminal or moves the controls and the verdict under it', async ({
      page,
    }) => {
      await open(page, '/runs/asi06-run');
      await bringStageIntoView(page);
      // Sample every frame of the whole playback: the terminal's box, and the
      // tops of the transport and the verdict, which a growing terminal would push.
      await page.evaluate(() => {
        const w = window as unknown as { __boxes: number[][]; __stop: boolean };
        const list = document.querySelector('ol[aria-label="Attack replay step timeline"]')!;
        const terminal = list.parentElement!;
        const transport = [...document.querySelectorAll('button[aria-label="Restart"]')].find(
          (b) => b.getBoundingClientRect().width > 0,
        )!.parentElement!;
        const verdict = document.querySelector('aside[aria-label="Detector verdict"]')!;
        w.__boxes = [];
        w.__stop = false;
        const tick = () => {
          const t = terminal.getBoundingClientRect();
          w.__boxes.push([
            t.top,
            t.height,
            transport.getBoundingClientRect().top,
            verdict.getBoundingClientRect().top,
          ]);
          if (!w.__stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.getByRole('button', { name: '4×' }).click();
      await page.getByRole('button', { name: 'Play' }).click();
      await expect(page.getByText(stepText(13))).toBeVisible({ timeout: 20_000 });
      // Let the last line finish typing.
      await expect(page.locator('button[aria-current="step"]')).toContainText('exit 0');
      const ranges = await page.evaluate(() => {
        const w = window as unknown as { __boxes: number[][]; __stop: boolean };
        w.__stop = true;
        const spread = (k: number) => {
          const xs = w.__boxes.map((b) => b[k]!);
          return Math.max(...xs) - Math.min(...xs);
        };
        return {
          frames: w.__boxes.length,
          terminalTop: spread(0),
          terminalHeight: spread(1),
          transportTop: spread(2),
          verdictTop: spread(3),
        };
      });
      expect(ranges.frames, 'frames sampled during playback').toBeGreaterThan(10);
      // Each measured against itself across the run: it does not move at all.
      expect(ranges.terminalTop).toBeLessThanOrEqual(1);
      expect(ranges.terminalHeight).toBeLessThanOrEqual(1);
      expect(ranges.transportTop).toBeLessThanOrEqual(1);
      expect(ranges.verdictTop).toBeLessThanOrEqual(1);
    });
  });
}
