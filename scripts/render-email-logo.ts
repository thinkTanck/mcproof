/**
 * RENDER THE EMAIL LOGO (LAUNCH POLISH, Part 7; owner ruling SIGN-IN EMAIL,
 * 2026-10-21).
 *
 * The sign-in email shows the real lockup (`LogoLockup`: the LogoRing and the
 * MCProof wordmark), not a redrawing of it. An email cannot run the site's CSS
 * or load its font, so the lockup is photographed: this opens the sign-in page
 * of a running build, where the lockup is drawn by the app's own component in
 * the site's colours and Geist Mono, puts it on the email's dark header band
 * (#05080B), and saves it at 2x to `public/email/mcproof-logo.png`, which is
 * served at https://mcproof.dev/email/mcproof-logo.png.
 *
 *   npm run build && npm run start      (in one terminal)
 *   npx tsx scripts/render-email-logo.ts [base-url]
 *
 * Motion is reduced, so the ring is drawn at rest with its arc where the
 * component starts it. It prints the PNG's CSS size, the width and height the
 * template's image tag must carry.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = join(process.cwd(), 'public', 'email', 'mcproof-logo.png');
const BAND = '#05080B';

async function main(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
      viewport: { width: 480, height: 400 },
    });
    // The boot splash is drawn over the first page of a visit; mark it seen.
    await page.addInitScript(() => window.sessionStorage.setItem('mcproof.boot.v1.seen', '1'));
    await page.goto(`${BASE}/sign-in`);
    await page.evaluate(() => document.fonts.ready);
    const lockup = page.locator('a[aria-label="MCProof home"]').first();
    // The band colour behind the mark and nothing else of the page, with room
    // around it so the mark does not touch the edge of the image.
    await lockup.evaluate((el, band) => {
      const a = el as HTMLElement;
      a.style.background = band;
      a.style.padding = '6px 10px';
      a.style.margin = '0';
      a.style.borderRadius = '0';
      a.style.outline = 'none';
      // A whole number of CSS pixels, so the 2x image is exactly twice the
      // size the email draws it at.
      a.style.boxSizing = 'border-box';
      const { width, height } = a.getBoundingClientRect();
      a.style.width = `${Math.ceil(width)}px`;
      a.style.height = `${Math.ceil(height)}px`;
    }, BAND);
    const box = await lockup.boundingBox();
    if (!box) throw new Error('the lockup was not drawn');
    mkdirSync(dirname(OUT), { recursive: true });
    await lockup.screenshot({ path: OUT, animations: 'disabled' });
    console.log(
      `wrote ${OUT}: ${Math.round(box.width)} x ${Math.round(box.height)} CSS px, ` +
        `${Math.round(box.width * 2)} x ${Math.round(box.height * 2)} pixels`,
    );
  } finally {
    await browser.close();
  }
}

void main();
