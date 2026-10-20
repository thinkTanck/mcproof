import { test, expect, type Page } from '@playwright/test';
import { expectNoWcagViolations, suppressBootSplash } from './support/screen';

/**
 * /about IN A REAL BROWSER (owner rulings 2026-10-18 and ABOUT REVISION,
 * 2026-10-19). Motion is checked by its END STATE only: the test waits for the
 * `data-state` the page sets, or for an element's own finite animations to
 * finish, and then reads what is drawn. No timing is asserted, and no timeout
 * is raised. Per the owner's rule, a flaky motion test is a stop, not a re-run.
 *
 * WHEN EACH TERMINAL TYPES: whoami on load; Why Sentinel only when scrolled to
 * (60% in view after a user scroll), or after whoami when it is already 60% in
 * view at load; never both at once.
 */

/** Short enough that the Sentinel terminal is not 60% in view at load. */
const SHORT = [
  { width: 375, height: 667 },
  { width: 1280, height: 500 },
] as const;
/** Tall enough that it is fully in view at load. */
const TALL = { width: 1280, height: 2000 } as const;

const terminal = (page: Page, id: 'whoami' | 'sentinel') => page.locator(`[data-terminal="${id}"]`);

/**
 * Record every state each terminal passes through, in order, from the first
 * byte: the order they happen in, never the time.
 */
async function recordStates(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __states: string[] };
    w.__states = [];
    const seen = new Map<Element, string>();
    const read = () => {
      for (const el of document.querySelectorAll('[data-terminal]')) {
        const now = `${el.getAttribute('data-terminal')}:${el.getAttribute('data-state')}`;
        if (seen.get(el) !== now) {
          seen.set(el, now);
          w.__states.push(now);
        }
      }
    };
    new MutationObserver(read).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state'],
    });
  });
}

async function open(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await suppressBootSplash(page);
  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeAttached();
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Wait for an element's own finite animations, if any, to finish. No timeout. */
async function ownAnimationsDone(page: Page, selector: string) {
  await page.locator(selector).evaluate(async (root) => {
    const targets = [root, ...root.querySelectorAll('[data-roadmap-card]')];
    for (const el of targets) void getComputedStyle(el).opacity;
    const own = targets
      .flatMap((el) => el.getAnimations())
      .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)));
    await Promise.all(own.map((a) => a.finished.catch(() => undefined)));
  });
}

/** Play the page to its end: whoami, then Sentinel scrolled to, then the roadmap. */
async function playAll(page: Page) {
  await expect(terminal(page, 'whoami')).toHaveAttribute('data-state', 'done', {
    timeout: 20_000,
  });
  await terminal(page, 'sentinel').scrollIntoViewIfNeeded();
  await expect(terminal(page, 'sentinel')).toHaveAttribute('data-state', 'done', {
    timeout: 20_000,
  });
  const roadmap = page.locator('[data-reveal="roadmap"]');
  await roadmap.scrollIntoViewIfNeeded();
  await expect(roadmap).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
  await ownAnimationsDone(page, '[data-reveal="roadmap"]');
}

/**
 * What the finished page draws. A terminal is SEEN through one layer (the
 * typed layer once typing has run, the final layer under reduced motion);
 * either way the seen words are the final layer's, with the caret after them.
 */
async function readFinished(page: Page) {
  return page.evaluate(() => {
    const opacity = (el: Element) => Number(getComputedStyle(el).opacity);
    const shown = (el: Element) => opacity(el) > 0 && getComputedStyle(el).visibility !== 'hidden';
    const words = (el: Element) =>
      [...el.querySelectorAll('p')].map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim());
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
    const cards = [...document.querySelectorAll('[data-roadmap-card]')].map(opacity);
    return { terminals, cards };
  });
}

const FINISHED = {
  terminals: Array.from({ length: 2 }, () => ({
    oneLayerSeen: true,
    allWordsSeen: true,
    caret: true,
  })),
  cards: Array.from({ length: 18 }, () => 1),
};

test('the server sends every animated part pending, never finished and then retyped', async ({
  request,
}) => {
  const html = await (await request.get('/about')).text();
  const states = [
    ...html.matchAll(/data-(?:terminal|reveal)="[^"]+"[^>]*?data-state="(\w+)"/g),
  ].map((m) => m[1]);
  expect(states).toEqual(['pending', 'pending', 'pending']);
  expect(html).toContain('visitor@mcproof:~$');
  expect(html).toContain('needs careful consideration.');
  expect(html).toContain('Sentinel is where we prove it.');
});

for (const viewport of SHORT) {
  test.describe(`/about at ${viewport.width}x${viewport.height}`, () => {
    test('whoami streams on load; Sentinel waits for a scroll, then streams', async ({ page }) => {
      await open(page, viewport);
      await expect(terminal(page, 'whoami')).toHaveAttribute('data-state', 'done', {
        timeout: 20_000,
      });
      // Loaded, whoami finished, no scroll: Sentinel has not started.
      await expect(terminal(page, 'sentinel')).toHaveAttribute('data-state', 'pending');
      await terminal(page, 'sentinel').scrollIntoViewIfNeeded();
      await expect(terminal(page, 'sentinel')).toHaveAttribute('data-state', 'done', {
        timeout: 20_000,
      });
    });

    test('plays to its finished state: every word, the caret, every card in', async ({ page }) => {
      await open(page, viewport);
      await playAll(page);
      expect(await readFinished(page)).toEqual(FINISHED);
    });

    test('the typing never changes a terminal’s height', async ({ page }) => {
      await open(page, viewport);
      const before = {
        whoami: (await terminal(page, 'whoami').boundingBox())!.height,
        sentinel: (await terminal(page, 'sentinel').boundingBox())!.height,
      };
      await playAll(page);
      expect((await terminal(page, 'whoami').boundingBox())!.height).toBe(before.whoami);
      expect((await terminal(page, 'sentinel').boundingBox())!.height).toBe(before.sentinel);
    });

    test('reduced motion shows the finished state at once', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, viewport);
      expect(await readFinished(page)).toEqual(FINISHED);
    });

    test('lays the roadmap out in the right number of columns, with no sideways scroll', async ({
      page,
    }) => {
      await open(page, viewport);
      const lefts = await page.evaluate(() => [
        ...new Set(
          [...document.querySelectorAll('[data-roadmap-column]')].map((c) =>
            Math.round(c.getBoundingClientRect().left),
          ),
        ),
      ]);
      expect(lefts).toHaveLength(viewport.width >= 768 ? 3 : 1);
      expect(await sideways(page)).toBe(0);
    });

    test('has no WCAG violation, finished and at rest', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, viewport);
      await expectNoWcagViolations(page);
    });

    test('is in the nav, and the nav lights it', async ({ page }) => {
      await open(page, viewport);
      if (viewport.width < 760) {
        await page.getByRole('button', { name: 'Open command deck' }).click();
      }
      const link = page.locator('a[href="/about"][aria-current="page"]').filter({ visible: true });
      await expect(link).toHaveCount(1);
    });
  });
}

test.describe(`/about at ${TALL.width}x${TALL.height}, Sentinel in view at load`, () => {
  test('Sentinel starts only after whoami finishes; never both typing', async ({ page }) => {
    await recordStates(page);
    await open(page, TALL);
    await expect(terminal(page, 'sentinel')).toHaveAttribute('data-state', 'done', {
      timeout: 20_000,
    });
    const states = await page.evaluate(
      () => (window as unknown as { __states: string[] }).__states,
    );
    // Sentinel's first move is after whoami is done, and it does finish.
    const whoamiDone = states.indexOf('whoami:done');
    const sentinelTyping = states.indexOf('sentinel:typing');
    expect(whoamiDone, states.join(' > ')).toBeGreaterThanOrEqual(0);
    expect(sentinelTyping, states.join(' > ')).toBeGreaterThan(whoamiDone);
    expect(states, states.join(' > ')).toContain('sentinel:done');
    // Never both typing: walk the order and track each one's state.
    const now: Record<string, string> = {};
    for (const entry of states) {
      const [id, state] = entry.split(':') as [string, string];
      now[id] = state;
      expect(now.whoami === 'typing' && now.sentinel === 'typing', states.join(' > ')).toBe(false);
    }
  });
});

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
