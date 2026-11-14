import { test, expect, type Page } from '@playwright/test';
import { expectNoWcagViolations, suppressBootSplash } from './support/screen';

/**
 * /about IN A REAL BROWSER (owner rulings 2026-10-18, ABOUT REVISION
 * 2026-10-19, ABOUT FINAL and ABOUT FINAL TITLES 2026-10-20).
 *
 * FINAL STATE ONLY, UNDER REDUCED MOTION (the ABOUT FLAKE 2 fallback, applied
 * for F-A on 2026-11-13). Every test here runs with `reducedMotion: 'reduce'`
 * (in `contextOptions`), so the terminal never plays: CSS shows the finished
 * screen before any script runs, and the page reports `data-state="done"`
 * once it hydrates. What is checked is what is drawn at the end: the terminal
 * text, the roadmap cards and the final prompt with its caret. The playback itself (each key at its own
 * offset, the paragraph rate, the total duration, catching up after a stall)
 * is timing, and timing is asserted on a faked clock in
 * `tests/unit/components/about/man-terminal-clock.test.tsx`, never in a
 * browser. (Waiting in WebKit for a 14.3 s playback to finish was the F-A
 * flake: on a loaded runner it was still typing at 25 s.)
 *
 * ONE TERMINAL: `man sentinel`, then `whoami`, then a fresh prompt with the
 * caret.
 */

test.use({ contextOptions: { reducedMotion: 'reduce' } });

const VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 1280, height: 800 },
] as const;

const BIO =
  "I build AI systems, and I'm pursuing an M.S. in Artificial Intelligence at Johns Hopkins. I built MCProof because AI agents are vulnerable to tool misuse. Tool use is an attack vector in the agent harness, and it needs careful consideration.";
const SENTINEL =
  "A sentinel is a guard posted to keep watch. Sentinel is MCProof's proving ground: a sealed test environment where your agent meets booby-trapped tools while our detector watches every step. In a replay, anything marked @sentinel happened inside it. MCProof is the proof. Sentinel is where we prove it.";

/** The final screen, exactly, one entry a line. */
const FINAL_SCREEN = [
  'visitor@mcproof:~$ man sentinel',
  'SENTINEL(7) MCProof Manual SENTINEL(7)',
  '',
  'NAME',
  "sentinel - MCProof's proving ground",
  '',
  'DESCRIPTION',
  SENTINEL,
  '',
  'visitor@mcproof:~$ whoami',
  'Dameion Ayers',
  BIO,
  '',
  'visitor@mcproof:~$',
];

const terminal = (page: Page) => page.locator('[data-terminal="about"]');

async function open(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await suppressBootSplash(page);
  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeAttached();
}

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * The page has hydrated into its final state. Under reduced motion nothing
 * plays, so this is the script mounting, not a playback finishing.
 */
async function hydratedDone(page: Page) {
  await expect(terminal(page)).toHaveAttribute('data-state', 'done');
  await expect(page.locator('[data-reveal="roadmap"]')).toHaveAttribute('data-state', 'done');
}

/**
 * What the finished page draws. The terminal is SEEN through one layer (the
 * typed layer, lying over the final one, once playback has run; the final
 * layer under reduced motion);
 * either way the seen lines are the final screen, with the caret after the
 * last prompt.
 */
async function readFinished(page: Page) {
  return page.evaluate(() => {
    const opacity = (el: Element) => Number(getComputedStyle(el).opacity);
    const shown = (el: Element) => opacity(el) > 0 && getComputedStyle(el).visibility !== 'hidden';
    const t = document.querySelector('[data-terminal]')!;
    const final = t.querySelector('[data-terminal-final]')!;
    const typed = t.querySelector('[data-terminal-typed]')!;
    // The typed layer, when shown, lies over the final one on an opaque
    // background of the same size, so it is the one seen; otherwise the final.
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    };
    const covers =
      shown(typed) &&
      box(typed) === box(final) &&
      getComputedStyle(typed).position !== 'static' &&
      !/rgba(.*,s*0)|transparent/.test(getComputedStyle(typed).backgroundColor);
    const layer = shown(typed) ? (covers ? typed : null) : shown(final) ? final : null;
    const lines = layer
      ? [...layer.querySelectorAll('[data-line]')].map((p) =>
          (p.textContent ?? '').replace(/\s+/g, ' ').trim(),
        )
      : [];
    const lastLine = layer?.querySelector('[data-line]:last-child');
    const caret = lastLine?.querySelector('[data-terminal-caret]');
    return {
      terminals: document.querySelectorAll('[data-terminal]').length,
      oneLayerSeen: layer !== null,
      lines,
      caretAtEnd: caret ? getComputedStyle(caret).visibility === 'visible' : false,
      cards: [...document.querySelectorAll('[data-roadmap-card]')].map(opacity),
    };
  });
}

const FINISHED = {
  terminals: 1,
  oneLayerSeen: true,
  lines: FINAL_SCREEN,
  caretAtEnd: true,
  cards: Array.from({ length: 13 }, () => 1),
};

test('the server sends every animated part pending, with every word of the final screen', async ({
  request,
}) => {
  const html = await (await request.get('/about')).text();
  const states = [
    ...html.matchAll(/data-(?:terminal|reveal)="[^"]+"[^>]*?data-state="(\w+)"/g),
  ].map((m) => m[1]);
  expect(states).toEqual(['pending', 'pending']);
  expect(html).toContain('visitor@mcproof:~$');
  expect(html).toContain('MCProof Manual');
  expect(html).toContain('Dameion Ayers');
  expect(html).toContain('needs careful consideration.');
  expect(html).toContain('Sentinel is where we prove it.');
});

for (const viewport of VIEWPORTS) {
  test.describe(`/about at ${viewport.width}x${viewport.height}`, () => {
    test('ends on the exact final screen: both commands, the man page, the name, the bio, the roadmap cards, the prompt', async ({
      page,
    }) => {
      await open(page, viewport);
      await hydratedDone(page);
      expect(await readFinished(page)).toEqual(FINISHED);
      // Every word is in the accessibility tree, from the final layer.
      const tree = await terminal(page).ariaSnapshot();
      expect(tree).toContain('MCProof Manual');
      expect(tree).toContain('Dameion Ayers');
      expect(tree).toContain('careful consideration.');
    });

    test('the typed layer and the final layer share one box, so the playback cannot change the terminal’s height', async ({
      page,
    }) => {
      await open(page, viewport);
      await hydratedDone(page);
      const boxes = await terminal(page).evaluate((t) => {
        const r = (sel: string) => {
          const b = t.querySelector(sel)!.getBoundingClientRect();
          return [b.left, b.top, b.width, b.height].map(Math.round);
        };
        return { final: r('[data-terminal-final]'), typed: r('[data-terminal-typed]') };
      });
      expect(boxes.typed).toEqual(boxes.final);
      const height = (await terminal(page).boundingBox())!.height;
      expect(height).toBeGreaterThanOrEqual(boxes.final[3]!);
    });

    test('reduced motion shows the finished screen at once, before the script hydrates', async ({
      page,
    }) => {
      await open(page, viewport);
      expect(await readFinished(page)).toEqual(FINISHED);
    });

    test('draws no visible About label and no Sentinel heading', async ({ page }) => {
      await open(page, viewport);
      await expect(page.getByRole('heading', { name: /sentinel/i })).toHaveCount(0);
      const visibleAbout = await page.evaluate(
        () =>
          [...document.querySelectorAll('main *')].filter((el) => {
            if (el.children.length > 0 || !/^about$/i.test((el.textContent ?? '').trim()))
              return false;
            const r = el.getBoundingClientRect();
            return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== 'hidden';
          }).length,
      );
      expect(visibleAbout).toBe(0);
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
      expect(lefts).toHaveLength(viewport.width >= 1024 ? 3 : 1);
      expect(await sideways(page)).toBe(0);
    });

    test('has no WCAG violation, finished and at rest', async ({ page }) => {
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

test('the man page header closes up on a phone, with no sideways scroll', async ({ page }) => {
  for (const width of [320, 375]) {
    await open(page, { width, height: 700 });
    expect(await sideways(page), `at ${width}`).toBe(0);
    const inside = await page.evaluate(() => {
      const box = document.querySelector('[data-terminal]')!.getBoundingClientRect();
      return [
        ...document.querySelectorAll('[data-terminal-final] [data-line="man-header"] span span'),
      ].every((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= box.left && r.right <= box.right;
      });
    });
    expect(inside, `at ${width}`).toBe(true);
  }
});

for (const width of [1024, 1280]) {
  test(`every roadmap card title holds one line at ${width}`, async ({ page }) => {
    await open(page, { width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    const titles = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-card-title]')].map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        // Boxes on one line share a top to within a few pixels; a new line
        // starts a full line height lower.
        const half = parseFloat(getComputedStyle(el).lineHeight) / 2;
        const tops = [...range.getClientRects()].map((r) => r.top).sort((a, b) => a - b);
        const lines = tops.filter((top, i) => i === 0 || top - tops[i - 1]! > half).length;
        return { text: el.textContent, lines };
      }),
    );
    expect(titles).toHaveLength(13);
    for (const title of titles) expect(title.lines, title.text ?? '').toBe(1);
  });
}

test('the /threats glossary prints the same Sentinel text, at the same anchor', async ({
  page,
}) => {
  await suppressBootSplash(page);
  await page.goto('/about');
  const about = (await page
    .locator('[data-terminal-final] [data-line="paragraph"]')
    .first()
    .textContent())!.trim();
  expect(about).toBe(SENTINEL);
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

test('the roadmap is headed "What\'s next..." with no note under it', async ({ page }) => {
  await suppressBootSplash(page);
  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText("What's next...");
  await expect(page.getByText('Planned, not promised')).toHaveCount(0);
  await expect(page.getByText('No dates.')).toHaveCount(0);
});
