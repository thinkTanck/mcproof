import { test, expect, type Page } from '@playwright/test';
import { expectNoWcagViolations, suppressBootSplash } from './support/screen';

/**
 * /about IN A REAL BROWSER (owner rulings 2026-10-18, ABOUT REVISION
 * 2026-10-19, ABOUT FINAL and ABOUT FINAL TITLES 2026-10-20). Motion is
 * checked by its END STATE only: the test waits for the `data-state` the page
 * sets, or for an element's own finite animations to finish, and then reads
 * what is drawn. The playback is read as what the typed layer held, in order,
 * never as a time. No timing is asserted and no timeout is raised. Per the
 * owner's rule, a flaky motion test is a stop, not a re-run.
 *
 * ONE TERMINAL, PLAYED ON LOAD: `man sentinel`, then `whoami`, then a fresh
 * prompt with the caret.
 */

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

/** Each line's kind, in order, as the script plays it. */
const KINDS = [
  'command',
  'short',
  'blank',
  'short',
  'short',
  'blank',
  'short',
  'paragraph',
  'blank',
  'command',
  'short',
  'paragraph',
  'blank',
  'prompt',
] as const;

const terminal = (page: Page) => page.locator('[data-terminal="about"]');
const DONE = { timeout: 25_000 };

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

/** Play the page to its end: the terminal, then the roadmap scrolled to. */
async function playAll(page: Page) {
  await expect(terminal(page)).toHaveAttribute('data-state', 'done', DONE);
  const roadmap = page.locator('[data-reveal="roadmap"]');
  await roadmap.scrollIntoViewIfNeeded();
  await expect(roadmap).toHaveAttribute('data-state', 'done', DONE);
  await ownAnimationsDone(page, '[data-reveal="roadmap"]');
}

/**
 * What the finished page draws. The terminal is SEEN through one layer (the
 * typed layer once playback has run, the final layer under reduced motion);
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
    const seen = [final, typed].filter(shown);
    const layer = seen.length === 1 ? seen[0]! : null;
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
    test('plays to the exact final screen: both commands, the man page, the name, the bio, the prompt', async ({
      page,
    }) => {
      await open(page, viewport);
      await playAll(page);
      expect(await readFinished(page)).toEqual(FINISHED);
    });

    test('prints short lines whole and builds up commands and paragraphs; the final text is always in the accessibility tree', async ({
      page,
    }) => {
      // Record what each typed line held, every time it changed, from the first byte.
      await page.addInitScript(() => {
        const w = window as unknown as { __seen: Record<string, string[]> };
        w.__seen = {};
        const read = () => {
          for (const el of document.querySelectorAll<HTMLElement>(
            '[data-terminal-typed] [data-line-index]',
          )) {
            const text = (el.querySelector('[data-line-text]')?.textContent ?? '')
              .replace(/\s+/g, ' ')
              .trim();
            const list = (w.__seen[el.dataset.lineIndex!] ??= []);
            if (list[list.length - 1] !== text) list.push(text);
          }
        };
        new MutationObserver(read).observe(document, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      });
      await open(page, viewport);
      await expect(terminal(page)).toHaveAttribute('data-state', 'typing');
      // Mid-playback, a reader of the accessibility tree already has every word.
      const midway = await terminal(page).ariaSnapshot();
      expect(midway).toContain('Dameion Ayers');
      expect(midway).toContain('careful consideration.');
      expect(midway).toContain('MCProof Manual');
      await expect(terminal(page)).toHaveAttribute('data-state', 'done', DONE);

      const seen = await page.evaluate(
        () => (window as unknown as { __seen: Record<string, string[]> }).__seen,
      );
      for (const [i, kind] of KINDS.entries()) {
        const full = FINAL_SCREEN[i]!.replace(/^visitor@mcproof:~\$ ?/, '');
        const history = seen[String(i)] ?? [];
        expect(history.at(-1), `line ${i} ends whole`).toBe(full);
        if (kind === 'short') expect(history, `short line ${i} printed whole`).toEqual([full]);
        if (kind === 'command' || kind === 'paragraph') {
          expect(history.length, `${kind} ${i} built up`).toBeGreaterThan(2);
          for (const step of history) expect(full.startsWith(step), `${kind} ${i}`).toBe(true);
        }
      }
    });

    test('the playback never changes the terminal’s height', async ({ page }) => {
      await open(page, viewport);
      const before = (await terminal(page).boundingBox())!.height;
      await playAll(page);
      expect((await terminal(page).boundingBox())!.height).toBe(before);
    });

    test('reduced motion shows the finished screen at once', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
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

test('the man page header closes up on a phone, with no sideways scroll', async ({ page }) => {
  for (const width of [320, 375]) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
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
    await page.emulateMedia({ reducedMotion: 'reduce' });
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
