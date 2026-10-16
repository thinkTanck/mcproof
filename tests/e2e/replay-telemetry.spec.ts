import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE RUN TELEMETRY IS PRINTED IN FULL, UNDER THE REPLAY'S TITLE (Batch G,
 * option B, owner ruling 2026-10-14).
 *
 * RUN, TARGET and DETECTOR used to sit in the header bar from 1100px, cut to
 * one line behind an ellipsis. They are now a line of the replay's own header,
 * which wraps, so every character is drawn inside the screen at every width,
 * the bar keeps its one row (the batch E height guards are unchanged), and
 * nothing scrolls sideways.
 */

async function open(page: Page, path: string) {
  await suppressBootSplash(page);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [320, 390, 1100, 1280]) {
  test.describe(`the replay's run telemetry at ${width}`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const run of ['sample', 'asi05-code-execution']) {
      test(`/runs/${run}: drawn whole, under the title, and not in the bar`, async ({ page }) => {
        await open(page, `/runs/${run}`);
        const m = await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>('[data-replay-telemetry]');
          if (!el) return null;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const title = document.querySelector('h1')!;
          return {
            text: el.innerText.replace(/\s+/g, ' ').trim(),
            ellipsis: style.textOverflow === 'ellipsis',
            cut: el.scrollWidth > el.clientWidth + 1,
            left: rect.left,
            right: rect.right,
            belowTitle: rect.top >= title.getBoundingClientRect().bottom - 1,
            barText: document.querySelector('[role="banner"]')?.textContent ?? '',
            viewport: document.documentElement.clientWidth,
            sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        });
        expect(m, 'the telemetry is drawn').not.toBeNull();
        expect(m!.text).toMatch(/^RUN \S+ · AGENT \S+ · DETECTOR BLIND TO THE ATTACK$/);
        expect(m!.ellipsis, 'no ellipsis').toBe(false);
        expect(m!.cut, 'nothing in it is clipped').toBe(false);
        expect(m!.left).toBeGreaterThanOrEqual(-1);
        expect(m!.right).toBeLessThanOrEqual(m!.viewport + 1);
        expect(m!.belowTitle, 'under the title').toBe(true);
        expect(m!.barText, 'the bar no longer prints it').not.toMatch(/DETECTOR/);
        expect(m!.sideways).toBeLessThanOrEqual(0);
      });
    }
  });
}
