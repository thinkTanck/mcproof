import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * FROM 768px UP THE REPLAY IS MAIN'S OWN (the guard for Part D, the phone layout).
 *
 * The phone layout reorders the replay and changes how the terminal is sized, so
 * this holds the wide layout to what main ships, as structure and never as
 * pixels (Linux CI draws fonts at other sizes than Windows does):
 *   - every class main puts on the stage, the grid, both terminals, the
 *     transport and the step detail is still there, and nothing else is, apart
 *     from classes scoped to the phone layout (`phone:`), which do not apply here;
 *   - the terminal keeps its inline height and its size container;
 *   - nothing built for the phone is left in the document (one transport, no
 *     reserved-height copy of the transcript);
 *   - the boxes are drawn in main's order and arrangement, and Tab visits them
 *     in main's order: terminal, verdict, controls.
 *
 * The class lists below are copied from main at 253010f.
 */
const MAIN = {
  stage: 'flex min-h-0 flex-1 flex-col gap-4 px-6 py-6 lg:px-8',
  grid: 'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]',
  terminal: 'overflow-y-auto rounded-lg px-4 py-3 font-mono text-[15px] leading-[1.6]',
  verdict: 'overflow-y-auto rounded-lg px-4 py-3 font-mono text-[15px] leading-[1.6]',
  transport: 'flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2.5',
  detail: 'flex h-[188px] flex-col overflow-hidden rounded-lg border border-line bg-panel',
};

async function open(page: Page) {
  await suppressBootSplash(page);
  await page.goto('/runs/sample');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

function snapshot(page: Page) {
  return page.evaluate(() => {
    const list = document.querySelector('ol[aria-label="Attack replay step timeline"]')!;
    const terminal = list.parentElement as HTMLElement;
    const verdict = document.querySelector('aside[aria-label="Detector verdict"]') as HTMLElement;
    const restarts = [...document.querySelectorAll('button[aria-label="Restart"]')];
    const transport = restarts[0]!.parentElement as HTMLElement;
    const detail = document.querySelector('section[aria-label="Step detail"]') as HTMLElement;
    const grid = verdict.parentElement as HTMLElement;
    const stage = detail.parentElement as HTMLElement;
    const wide = (el: Element) =>
      [...el.classList].filter((c) => !c.startsWith('phone:')).join(' ');
    const r = (el: Element) => el.getBoundingClientRect();
    return {
      classes: {
        stage: wide(stage),
        grid: wide(grid),
        terminal: wide(terminal),
        verdict: wide(verdict),
        transport: wide(transport),
        detail: wide(detail),
      },
      terminalHeightStyle: terminal.style.height,
      terminalContainer: getComputedStyle(terminal).containerType,
      terminalChildren: terminal.children.length,
      transports: restarts.length,
      rects: {
        terminal: r(terminal).toJSON() as DOMRect,
        verdict: r(verdict).toJSON() as DOMRect,
        transport: r(transport).toJSON() as DOMRect,
        detail: r(detail).toJSON() as DOMRect,
      },
    };
  });
}

for (const vp of [
  { width: 1280, height: 900 },
  { width: 768, height: 1024 },
] as const) {
  test.describe(`replay at ${vp.width}x${vp.height}: as on main`, () => {
    test.use({ viewport: vp });

    test('the same classes, the same terminal sizing, and nothing built for the phone', async ({
      page,
    }) => {
      await open(page);
      const s = await snapshot(page);
      expect(s.classes).toEqual(MAIN);
      expect(s.terminalHeightStyle).toBe('clamp(280px, 40vh, 460px)');
      expect(s.terminalContainer).toBe('size');
      // The step list and the bottom room that lets the newest line sit mid-box.
      expect(s.terminalChildren).toBe(2);
      expect(s.transports).toBe(1);
    });

    test("the boxes sit in main's arrangement", async ({ page }) => {
      await open(page);
      const { rects: r } = await snapshot(page);
      // The two terminals are the same height (one shared clamp) wherever they sit.
      expect(r.terminal.height / r.verdict.height).toBeCloseTo(1, 2);
      if (vp.width >= 1024) {
        // Side by side, verdict on the right, tops aligned.
        expect(r.verdict.left).toBeGreaterThanOrEqual(r.terminal.right);
        expect(Math.abs(r.verdict.top - r.terminal.top)).toBeLessThanOrEqual(1);
      } else {
        // One column: terminal, then verdict.
        expect(r.verdict.top).toBeGreaterThanOrEqual(r.terminal.bottom);
      }
      // The transport under both terminals, the step detail under the transport.
      expect(r.transport.top).toBeGreaterThanOrEqual(Math.max(r.terminal.bottom, r.verdict.bottom));
      expect(r.detail.top).toBeGreaterThanOrEqual(r.transport.bottom);
    });

    test('Tab visits terminal, verdict, then controls, as on main', async ({ page }) => {
      await open(page);
      await page.getByRole('link', { name: 'Skip to content' }).focus();
      const regions: string[] = [];
      for (let i = 0; i < 40; i += 1) {
        await page.keyboard.press('Tab');
        const region = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          if (el.closest('ol[aria-label="Attack replay step timeline"]')) return 'terminal';
          if (el.closest('aside[aria-label="Detector verdict"]')) return 'verdict';
          if (el.closest('div:has(> button[aria-label="Restart"])')) return 'controls';
          return 'other';
        });
        if (regions[regions.length - 1] !== region) regions.push(region);
        if (region === 'controls') break;
      }
      expect(regions.filter((r) => r !== 'other')).toEqual(['terminal', 'verdict', 'controls']);
    });
  });
}
