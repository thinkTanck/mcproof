import { test, expect, type Page } from '@playwright/test';
import { expectNoWcagViolations, suppressBootSplash } from './support/screen';

/**
 * /about IN A REAL BROWSER (owner rulings 2026-10-18). Motion is checked by its
 * END STATE only: a part is scrolled into view, the test waits for the
 * `data-state="done"` the page sets, and then reads what is drawn. No timing is
 * asserted. Per the owner's rule, a flaky motion test is a stop, not a re-run.
 */

async function open(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await suppressBootSplash(page);
  await page.goto('/about');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Built by Dameion Ayers' }),
  ).toBeVisible();
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Scroll every animated part into view, one at a time, and wait for each to finish. */
async function playAll(page: Page) {
  for (const selector of [
    '[data-terminal="whoami"]',
    '[data-terminal="sentinel"]',
    '[data-reveal="career"]',
    '[data-reveal="roadmap"]',
  ]) {
    const part = page.locator(selector);
    await part.scrollIntoViewIfNeeded();
    await expect(part).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    // Then wait for THIS part's own animations to finish (owner ruling ABOUT
    // FLAKE 2): the career line drawing, each roadmap card coming in. Style is
    // read first, so a transition the state flip starts exists before it is
    // looked for; an animation that never ends (the terminal caret's blink) is
    // left out; with nothing running this resolves at once. No timeout.
    await part.evaluate(async (root) => {
      const targets = [root, ...root.querySelectorAll('.career-path, [data-roadmap-card]')];
      for (const el of targets) void getComputedStyle(el).opacity;
      const own = targets
        .flatMap((el) => el.getAnimations())
        .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)));
      await Promise.all(own.map((a) => a.finished.catch(() => undefined)));
    });
  }
}

/**
 * What the finished page draws: every word, the line, every card. A terminal
 * is SEEN through one layer: the typed layer once typing has run, the final
 * layer under reduced motion. Either way the seen words must be the final
 * layer's words, with the caret after them.
 */
async function readFinished(page: Page) {
  return page.evaluate(() => {
    const opacity = (el: Element) => Number(getComputedStyle(el).opacity);
    const shown = (el: Element) => opacity(el) > 0 && getComputedStyle(el).visibility !== 'hidden';
    const words = (el: Element) =>
      [...el.querySelectorAll('p')].map((p) => (p.textContent ?? '').replace(/s+/g, ' ').trim());
    const terminals = [...document.querySelectorAll('[data-terminal]')].map((t) => {
      const final = t.querySelector('[data-terminal-final]')!;
      const typed = t.querySelector('[data-terminal-typed]')!;
      const seen = [final, typed].filter(shown);
      const layer = seen.length === 1 ? seen[0]! : null;
      const caret = layer?.querySelector('[data-terminal-caret]');
      return {
        oneLayerSeen: layer !== null,
        allWordsSeen:
          layer !== null && JSON.stringify(words(layer)) === JSON.stringify(words(final)),
        caret: caret ? getComputedStyle(caret).visibility === 'visible' : false,
      };
    });
    const paths = [...document.querySelectorAll('.career-path')]
      .filter((p) => (p as SVGGraphicsElement).getBoundingClientRect().width > 0)
      .map((p) => parseFloat(getComputedStyle(p).strokeDashoffset));
    const cards = [...document.querySelectorAll('[data-roadmap-card]')].map(opacity);
    return { terminals, paths, cards };
  });
}

const FINISHED = (terminals = 2) => ({
  terminals: Array.from({ length: terminals }, () => ({
    oneLayerSeen: true,
    allWordsSeen: true,
    caret: true,
  })),
  paths: [0],
  cards: Array.from({ length: 18 }, () => 1),
});

test('the server sends every animated part pending, never finished and then retyped', async ({
  request,
}) => {
  const html = await (await request.get('/about')).text();
  const states = [
    ...html.matchAll(/data-(?:terminal|reveal)="[^"]+"[^>]*?data-state="(\w+)"/g),
  ].map((m) => m[1]);
  expect(states.length).toBe(4);
  expect(new Set(states)).toEqual(new Set(['pending']));
  // And every word is already there.
  expect(html).toContain('dameion-ayers');
  expect(html).toContain('Sentinel is where we prove it.');
});

for (const [width, height] of [
  [375, 812],
  [1280, 900],
] as const) {
  test.describe(`/about at ${width}`, () => {
    test('plays once to its finished state: every word, the line drawn, every card in', async ({
      page,
    }) => {
      await open(page, width, height);
      await playAll(page);
      expect(await readFinished(page)).toEqual(FINISHED());
    });

    test('the typing never changes a terminal’s height', async ({ page }) => {
      await open(page, width, height);
      const whoami = page.locator('[data-terminal="whoami"]');
      const before = (await whoami.boundingBox())!.height;
      await playAll(page);
      expect((await whoami.boundingBox())!.height).toBe(before);
    });

    test('reduced motion shows the finished state at once', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, width, height);
      expect(await readFinished(page)).toEqual(FINISHED());
    });

    test('draws the line the right way round, and the roadmap in the right number of columns', async ({
      page,
    }) => {
      await open(page, width, height);
      const visible = await page.evaluate(() =>
        [...document.querySelectorAll('[data-career-line] svg[data-orientation]')]
          .filter((s) => s.getBoundingClientRect().width > 0)
          .map((s) => s.getAttribute('data-orientation')),
      );
      expect(visible).toEqual([width >= 768 ? 'horizontal' : 'vertical']);
      const lefts = await page.evaluate(() => [
        ...new Set(
          [...document.querySelectorAll('[data-roadmap-column]')].map((c) =>
            Math.round(c.getBoundingClientRect().left),
          ),
        ),
      ]);
      expect(lefts).toHaveLength(width >= 768 ? 3 : 1);
      expect(await sideways(page)).toBe(0);
    });

    test('has no WCAG violation, finished and at rest', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, width, height);
      await expectNoWcagViolations(page);
    });

    test('is in the nav, and the nav lights it', async ({ page }) => {
      await open(page, width, height);
      if (width < 760) await page.getByRole('button', { name: 'Open command deck' }).click();
      const link = page.locator('a[href="/about"][aria-current="page"]').filter({ visible: true });
      await expect(link).toHaveCount(1);
    });
  });
}

test('the /threats glossary prints the same Sentinel text, at the same anchor', async ({
  page,
}) => {
  await suppressBootSplash(page);
  await page.goto('/about');
  const about = (await page
    .locator('[data-terminal="sentinel"] [data-terminal-final] p')
    .nth(1)
    .textContent())!.trim();
  await page.goto('/threats#sentinel');
  const glossary = (await page.locator('#sentinel dd').textContent())!.trim();
  expect(glossary).toBe(about);
});

test('a replay’s "@sentinel" link still lands on the glossary entry', async ({ page }) => {
  await suppressBootSplash(page);
  await page.goto('/runs/sample');
  const href = await page.locator('a[href="/threats#sentinel"]').first().getAttribute('href');
  expect(href).toBe('/threats#sentinel');
  await page.goto(href!);
  await expect(page.locator('#sentinel dd')).toBeVisible();
});
