import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * THE HERO'S BREACH WAITS FOR THE SWEEP (owner ruling 2026-10-18). While the
 * hero animation plays, the breach row shows no reticle, no BREACH badge and no
 * red; when the first sweep reaches the last step, the marker and the badge are
 * applied. Reduced motion shows the finished picture at once. There is no
 * "Show verdict now" on the hero.
 *
 * Mid-animation is read by PAUSING the hold animations at the start of their
 * delay, not by racing the clock, so the reading is the same on any machine.
 */

async function home(page: Page) {
  await suppressBootSplash(page);
  await page.goto('/');
  await expect(page.locator('[data-testid="hero-step"]').first()).toBeVisible();
}

/** Opacity of each waiting part of the breach row, as drawn right now. */
const read = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector<HTMLElement>(
      '[data-testid="hero-step"][data-breach="true"]',
    )!;
    const part = (name: string) =>
      Number(getComputedStyle(row.querySelector(`[data-hero-reveal="${name}"]`)!).opacity);
    const ink = row.querySelector<HTMLElement>('[data-hero-reveal="ink"]')!;
    const breachInk = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-breach')
      .trim();
    return {
      marker: part('marker'),
      badge: part('badge'),
      tint: part('tint'),
      pendingNode: part('pending-node'),
      inkIsBreach: (() => {
        const probe = document.createElement('span');
        probe.style.color = breachInk;
        document.body.append(probe);
        const want = getComputedStyle(probe).color;
        probe.remove();
        return getComputedStyle(ink).color === want;
      })(),
    };
  });

/** Hold every reveal animation at one point in its own timeline. */
const seek = (page: Page, where: 'start' | 'end') =>
  page.evaluate((w) => {
    const holds = document
      .getAnimations()
      .filter((a) => (a as CSSAnimation).animationName?.startsWith('hero-hold-'));
    for (const a of holds) {
      a.pause();
      const timing = a.effect!.getComputedTiming();
      a.currentTime = w === 'start' ? 0 : Number(timing.endTime) + 1;
    }
    return holds.length;
  }, where);

for (const [width, height] of [
  [1280, 900],
  [390, 844],
] as const) {
  test.describe(`hero breach reveal at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('mid-animation the breach row has no marker, no badge and no red', async ({ page }) => {
      await home(page);
      expect(await seek(page, 'start')).toBeGreaterThan(0);
      expect(await read(page)).toEqual({
        marker: 0,
        badge: 0,
        tint: 0,
        pendingNode: 1,
        inkIsBreach: false,
      });
    });

    test('once the sweep reaches the last step, the marker and the badge are applied', async ({
      page,
    }) => {
      await home(page);
      await seek(page, 'end');
      expect(await read(page)).toEqual({
        marker: 1,
        badge: 1,
        tint: 1,
        pendingNode: 0,
        inkIsBreach: true,
      });
    });

    test('reduced motion shows the finished picture at once', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await home(page);
      expect(await read(page)).toEqual({
        marker: 1,
        badge: 1,
        tint: 1,
        pendingNode: 0,
        inkIsBreach: true,
      });
    });

    test('the hero offers no "Show verdict now"', async ({ page }) => {
      await home(page);
      await expect(page.getByRole('button', { name: /show verdict now/i })).toHaveCount(0);
    });
  });
}
