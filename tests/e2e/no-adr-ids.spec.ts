import { test, expect } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * LAUNCH POLISH, Part 5a (owner ruling COPY FIX, 2026-10-21): no ADR id and no
 * internal jargon on any screen a person reads. ADR ids belong to the design
 * records in docs/, and a reader of the product cannot look one up.
 *
 * Every page that needs no account, in the text a reader sees and the
 * attributes a screen reader or a tooltip reads, after the replays have shown
 * their verdict. A live run's replay (the one place an ADR id was printed, in
 * the recorder's end-of-session sentence) is held in
 * tests/unit/components/replay/session-ended.test.tsx.
 */
const FIXTURES_BUILT = process.env.E2E_FIXTURES === '1';

const SAMPLES = [
  'sample',
  'asi01-goal-hijack',
  'asi03-identity-privilege-abuse',
  'asi04-run',
  'asi05-code-execution',
  'asi06-run',
  'asi10-goal-drift',
] as const;

const PAGES: { path: string; fixture?: true }[] = [
  { path: '/' },
  { path: '/connect' },
  { path: '/leaderboard' },
  { path: '/threats' },
  { path: '/about' },
  { path: '/sign-in' },
  { path: '/account' },
  { path: '/no-such-page' },
  ...SAMPLES.flatMap((id) => [{ path: `/runs/${id}` }, { path: `/findings/${id}` }]),
  { path: '/e2e/leaderboard', fixture: true },
  { path: '/e2e/connect-states?state=run-discarded', fixture: true },
  { path: '/e2e/connect-states?state=report-discarded', fixture: true },
];

for (const p of PAGES) {
  test(`${p.path}: no ADR id on the page`, async ({ page }) => {
    test.skip(p.fixture === true && !FIXTURES_BUILT, 'E2E_FIXTURES=1 is unset.');
    await suppressBootSplash(page);
    await page.goto(p.path);
    // A replay shows its verdict on request; reveal it so its text is read too.
    const showNow = page.getByRole('button', { name: 'Show verdict now' });
    if (await showNow.isVisible().catch(() => false)) await showNow.click();
    const found = await page.evaluate(() => {
      const hits: string[] = [];
      if (/ADR-\d/i.test(document.body.innerText)) hits.push('text');
      if (/ADR-\d/i.test(document.title)) hits.push('title');
      for (const el of document.body.querySelectorAll('*')) {
        for (const attr of ['aria-label', 'title', 'alt', 'aria-description', 'placeholder']) {
          const v = el.getAttribute(attr);
          if (v && /ADR-\d/i.test(v)) hits.push(`${el.tagName.toLowerCase()}[${attr}]`);
        }
      }
      return hits;
    });
    expect(found).toEqual([]);
  });
}
