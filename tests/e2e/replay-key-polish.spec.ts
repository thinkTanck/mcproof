import { test, expect, type Page } from '@playwright/test';
import { expectNoWcagViolations, suppressBootSplash } from './support/screen';

/**
 * KEY POLISH IN A REAL BROWSER (owner ruling 2026-10-20).
 *
 *  - The Key is one two-column grid: every definition starts on one left edge.
 *  - Open, it is its own bordered panel with clear room above the terminal.
 *  - The transcript's title bar reads AGENT SESSION and the run id; the
 *    verdict's reads DETECTOR.
 *  - The verdict rail says what was tested and what was detected.
 *
 * Structure and ranges, never exact pixels, except that edges which must be
 * one edge are compared to within a pixel.
 */

const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 375, height: 812 },
] as const;

const legend = (page: Page) =>
  page.locator('details[data-replay-legend]').filter({ visible: true });

async function open(page: Page, run: string, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await suppressBootSplash(page);
  await page.goto(`/runs/${run}`);
  await expect(page.getByRole('button', { name: 'Play', exact: true }).first()).toBeAttached();
}

async function openKey(page: Page) {
  await legend(page).locator('summary').click();
  await expect(legend(page)).toHaveAttribute('open', '');
}

for (const viewport of VIEWPORTS) {
  test.describe(`replay key polish at ${viewport.width}x${viewport.height}`, () => {
    for (const run of ['sample', 'asi10-goal-drift'] as const) {
      test(`/runs/${run}: every definition in the Key starts on one left edge`, async ({
        page,
      }) => {
        await open(page, run, viewport);
        await openKey(page);
        const edges = await legend(page).evaluate((el) => {
          const rows = [...el.querySelectorAll('[data-whos-who] > [data-role]')];
          return rows.map((row) => {
            const dt = row.querySelector(':scope > dt')!.getBoundingClientRect();
            const dd = row.querySelector(':scope > dd')!.getBoundingClientRect();
            return { dt: dt.right, dd: dd.left, ddWidth: dd.width };
          });
        });
        expect(edges).toHaveLength(5);
        const left = edges[0]!.dd;
        for (const e of edges) {
          expect(Math.abs(e.dd - left), 'one left edge').toBeLessThanOrEqual(1);
          // The text is beside its chip, never under it.
          expect(e.dd).toBeGreaterThan(e.dt - 1);
          expect(e.ddWidth).toBeGreaterThan(0);
        }
        // A wrapped definition wraps under itself: every line box starts at its left edge.
        const lineStarts = await legend(page).evaluate((el) =>
          [...el.querySelectorAll('[data-whos-who] dd')].flatMap((dd) => {
            const range = document.createRange();
            range.selectNodeContents(dd);
            const left = dd.getBoundingClientRect().left;
            return [...range.getClientRects()].map((r) => r.left - left);
          }),
        );
        for (const start of lineStarts) expect(start).toBeGreaterThanOrEqual(-1);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        ).toBe(0);
      });
    }

    test('the detector definition reads exactly, in the Key and in its pop-up', async ({
      page,
    }) => {
      const DEFINITION = 'Judges the finished run and marks the compromised step, if any.';
      await open(page, 'sample', viewport);
      await openKey(page);
      await expect(legend(page).locator('[data-role="detector"] dd')).toHaveText(
        `MCProof detector. ${DEFINITION}`,
      );
      const verdict = page.locator('aside[aria-label="Detector verdict"]');
      await verdict.locator('summary').first().click();
      await expect(verdict.locator('[data-speaker-panel]').first()).toContainText(DEFINITION);
    });

    test('the open Key is its own bordered panel, with clear room above the terminal', async ({
      page,
    }) => {
      await open(page, 'sample', viewport);
      await openKey(page);
      const m = await page.evaluate(() => {
        const details = [...document.querySelectorAll('details[data-replay-legend]')].find(
          (d) => (d as HTMLElement).offsetParent !== null,
        )!;
        const panel = details.querySelector('[data-key-panel]')!;
        const style = getComputedStyle(panel);
        const bar = document.querySelector('[data-title-bar="session"]')!;
        return {
          border: parseFloat(style.borderTopWidth),
          borderColor: style.borderTopColor,
          background: style.backgroundColor,
          gap: bar.getBoundingClientRect().top - panel.getBoundingClientRect().bottom,
        };
      });
      expect(m.border).toBeGreaterThanOrEqual(1);
      expect(m.borderColor).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      expect(m.background).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      expect(m.gap, 'room between the Key and the terminal').toBeGreaterThanOrEqual(16);
    });

    test('the title bars name the session, with the run id, and the detector', async ({ page }) => {
      await open(page, 'sample', viewport);
      const session = page.locator('[data-title-bar="session"]');
      await expect(session.locator('[data-title-bar-name]')).toHaveText('AGENT SESSION');
      await expect(session.locator('[data-title-bar-run]')).toHaveText('sample');
      await expect(page.locator('[data-title-bar="detector"] [data-title-bar-name]')).toHaveText(
        'DETECTOR',
      );
      // Each bar sits directly on top of its box.
      const gaps = await page.evaluate(() =>
        ['session', 'detector'].map((id) => {
          const bar = document.querySelector(`[data-title-bar="${id}"]`)!;
          const box = bar.nextElementSibling!;
          return box.getBoundingClientRect().top - bar.getBoundingClientRect().bottom;
        }),
      );
      for (const gap of gaps) expect(Math.abs(gap)).toBeLessThanOrEqual(1);
    });

    for (const [run, tested, detected] of [
      ['asi10-goal-drift', 'ASI10 Rogue Agents', 'ASI01 Agent Goal Hijack'],
      ['asi01-goal-hijack', 'ASI01 Agent Goal Hijack', 'ASI01 Agent Goal Hijack'],
    ] as const) {
      test(`/runs/${run}: the verdict says tested ${tested.split(' ')[0]}, detected as ${detected.split(' ')[0]}`, async ({
        page,
      }) => {
        await open(page, run, viewport);
        await page.getByRole('button', { name: 'Show verdict now' }).click();
        const rail = page.locator('aside[aria-label="Detector verdict"]');
        await expect(rail.locator('[data-verdict-row="tested"]')).toHaveText(
          new RegExp(`^tested\\s+${tested}$`),
        );
        await expect(rail.locator('[data-verdict-row="category"]')).toHaveText(
          new RegExp(`^detected as\\s+${detected}$`),
        );
        const order = await rail
          .locator('[data-verdict-row]')
          .evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.verdictRow));
        expect(order.slice(0, 3)).toEqual(['outcome', 'tested', 'category']);
      });
    }

    test('has no WCAG violation with the Key open and the verdict shown', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, 'asi10-goal-drift', viewport);
      await openKey(page);
      await page.getByRole('button', { name: 'Show verdict now' }).click();
      await expectNoWcagViolations(page);
    });
  });
}
