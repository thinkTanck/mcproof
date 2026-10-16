import { test, expect, type Page } from '@playwright/test';
import { expectNoWcagViolations, suppressBootSplash } from './support/screen';
import {
  ROLES,
  SENTINEL_GLOSSARY_HREF,
  SENTINEL_GLOSSARY_TEXT,
  handleName,
  roleForHandle,
} from '../../src/lib/replay/roles';

/**
 * THE REPLAY LEGEND, THE SPEAKER ROLES AND WHAT SENTINEL IS (Batch G, 2026-10-13).
 *
 * Reported from a desk: the colour key sat under the playback controls and the
 * step card, far from the terminal it explains; nothing said who
 * `user@console` or `target-agent@sentinel` is; and the header still carried
 * the design's internal name, "SENTINEL FIELDS".
 *
 * Measured in a real browser:
 *
 *  1. ONE LEGEND, DIRECTLY ABOVE THE TERMINAL: who is who, then the colour key.
 *     Its bottom edge is at or above the terminal's top edge, on every sample
 *     run. The key under the step detail is gone.
 *  2. ON A PHONE IT IS A "KEY" DISCLOSURE, CLOSED WHEN THE PAGE OPENS. The
 *     terminal is at most 45% of the screen, Play is no lower than it was, and
 *     on Connect the run bar is still on screen when the page opens.
 *  3. EVERY HANDLE OPENS ITS DEFINITION, with a press, a tap, Enter or Space.
 *     Escape closes it and gives focus back; a press outside closes it; one is
 *     open at a time; it is drawn inside the terminal and inside the screen.
 *     Pressing a handle never moves the playhead.
 *  4. THE GLOSSARY SAYS WHAT SENTINEL IS, word for word, and the first
 *     "@sentinel" on a replay is a link to it that the keyboard can follow.
 *  5. "SENTINEL FIELDS" IS ON NO PAGE.
 *  6. NOTHING IN THE VERDICT RAIL OR THE NAV RAIL IS CUT OFF at 1024, 1280 and
 *     1440, in the loaded font and in the fallback.
 *  7. HOME SAYS HOW A TEST WORKS, in five steps, without moving the two calls
 *     to action.
 *
 * WebKit stands in for an iPhone and runs the phone widths. The axe scan is
 * Chromium only (Playwright's Windows WebKit crashes on two of its rules).
 *
 * No exact pixel sizes: "at or above", "inside", ratios of the screen, floors.
 */

const FIXTURES_BUILT = process.env.E2E_FIXTURES === '1';
const WEBKIT_IS_A_PHONE = 'WebKit stands in for an iPhone: it is measured at the phone width.';
const NO_FIXTURES =
  'NOT COVERED: E2E_FIXTURES=1 is unset, so the fixture route this state needs is not built.';
/** Sub-pixel rounding at an edge. */
const EDGE = 1;
const TARGET_MIN = 44;

/** The seven sample runs: the featured one by its alias, the rest by run id. */
const SAMPLE_RUNS = [
  'sample',
  'asi01-goal-hijack',
  'asi03-identity-privilege-abuse',
  'asi04-run',
  'asi05-code-execution',
  'asi06-run',
  'asi10-goal-drift',
] as const;

const WIDE = [
  { width: 1280, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
] as const;
const PHONES = [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
] as const;

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function openReplay(page: Page, run: string = 'sample') {
  await suppressBootSplash(page);
  await page.goto(`/runs/${run}`);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  // The server sends the legend twice (it cannot see the width) and the
  // browser keeps the one that fits. Measured once it has.
  await expect(page.locator('[data-replay-legend]')).toHaveCount(1);
  await settle(page);
}

async function toEnd(page: Page) {
  await page.getByRole('slider', { name: 'Scrub to step' }).focus();
  await page.keyboard.press('End');
  await expect(page.locator('button[aria-current="step"]')).toContainText('exit 0');
  await settle(page);
}

/** The legend that is drawn (one of the two the server sends), and the boxes around it. */
function layout(page: Page) {
  return page.evaluate(() => {
    const list = document.querySelector('ol[aria-label="Attack replay step timeline"]')!;
    const terminal = list.parentElement as HTMLElement;
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const legends = [...document.querySelectorAll('[data-replay-legend]')].filter(shown);
    const legend = legends[0] as HTMLElement | undefined;
    const detail = document.querySelector('section[aria-label="Step detail"]') as HTMLElement;
    const stage = detail.parentElement as HTMLElement;
    const stageStyle = getComputedStyle(stage);
    const play = [...document.querySelectorAll('button[aria-label="Play"]')].find(shown);
    const transport = [...document.querySelectorAll('button[aria-label="Restart"]')].find(
      shown,
    )?.parentElement;
    const keys = [...document.querySelectorAll('[data-replay-key]')];
    const rect = (el: Element | undefined | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
    };
    const describedBy = list.getAttribute('aria-describedby');
    return {
      legends: legends.length,
      legendKind: legend?.getAttribute('data-replay-legend') ?? null,
      legendTag: legend?.tagName.toLowerCase() ?? null,
      legendOpen: legend instanceof HTMLDetailsElement ? legend.open : null,
      legend: rect(legend),
      terminal: rect(terminal)!,
      play: rect(play),
      transport: rect(transport),
      stage: rect(stage)!,
      stagePadTop: parseFloat(stageStyle.paddingTop),
      stageGap: parseFloat(stageStyle.rowGap),
      keys: keys.length,
      keyAfterDetail: keys.some(
        (key) => detail.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      describedBy,
      describedTargets: describedBy ? document.querySelectorAll(`[id="${describedBy}"]`).length : 0,
      describedInLegend: Boolean(
        describedBy && legend && legend.contains(document.getElementById(describedBy)),
      ),
      viewport: { width: innerWidth, height: innerHeight },
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

// ── 1. one legend, directly above the terminal ───────────────────────────────

for (const viewport of [...WIDE, ...PHONES]) {
  test.describe(`1. the legend above the terminal at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const run of SAMPLE_RUNS) {
      test(`/runs/${run}: the legend ends at or above the terminal, and no key is left under the step detail`, async ({
        page,
        browserName,
      }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        await openReplay(page, run);
        const m = await layout(page);
        expect(m.legends, 'one legend is drawn').toBe(1);
        expect(m.legend!.bottom, 'legend bottom <= terminal top').toBeLessThanOrEqual(
          m.terminal.top + EDGE,
        );
        // Directly above: nothing but a gap between the two.
        expect(m.terminal.top - m.legend!.bottom).toBeLessThanOrEqual(m.stageGap * 2 + EDGE);
        expect(m.keys, 'one colour key in the document').toBe(1);
        expect(m.keyAfterDetail, 'no key after the step detail').toBe(false);
        // The transcript still points at the key, the key is in the legend,
        // and the id is on one element.
        expect(m.describedBy).toBe('replay-key');
        expect(m.describedTargets).toBe(1);
        expect(m.describedInLegend).toBe(true);
        expect(m.sideways, 'no sideways scroll').toBeLessThanOrEqual(0);
      });
    }

    test('the Key is a closed disclosure when the page opens', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await openReplay(page);
      const m = await layout(page);
      // Owner ruling 2026-10-14: closed by default at every width, above the terminal.
      expect(m.legendTag).toBe('details');
      expect(m.legendOpen).toBe(false);
    });

    test('who is who: four roles, each in the words of the roles lookup', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await openReplay(page);
      const legend = page.locator('[data-replay-legend]').filter({ visible: true });
      // The Key is closed when the page opens, at every width: open it first.
      await legend.locator('summary').click();
      const entries = legend.locator('[data-whos-who] [data-role]');
      await expect(entries).toHaveCount(4);
      for (const id of ['operator', 'agent', 'detector', 'tool'] as const) {
        const entry = legend.locator(`[data-role="${id}"]`);
        await expect(entry).toBeVisible();
        await expect(entry).toContainText(`${ROLES[id].name}. ${ROLES[id].definition}`);
      }
      await expect(legend.locator('[data-role="operator"]')).toContainText('user@console');
      await expect(legend.locator('[data-role="agent"]')).toContainText('target-agent@sentinel');
      await expect(legend.locator('[data-role="detector"]')).toContainText('detector@sentinel');
      // Text at or above the 12px floor, and no entry wider than the screen.
      const sizes = await entries.evaluateAll((nodes) =>
        nodes.flatMap((node) =>
          [node, ...node.querySelectorAll('*')].map((el) => ({
            size: parseFloat(getComputedStyle(el).fontSize),
            right: el.getBoundingClientRect().right,
          })),
        ),
      );
      for (const s of sizes) {
        expect(s.size).toBeGreaterThanOrEqual(12);
        expect(s.right).toBeLessThanOrEqual(viewport.width + EDGE);
      }
    });
  });
}

// ── 1b. Play above the fold at 1280x720, with the Key closed ───────────────

test.describe('1b. Play above the fold at 1280x720 with the Key closed', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  for (const run of SAMPLE_RUNS) {
    test(`/runs/${run}: Play is on the first screen`, async ({ page, browserName }) => {
      test.skip(browserName === 'webkit', WEBKIT_IS_A_PHONE);
      await openReplay(page, run);
      const m = await layout(page);
      expect(m.legendOpen, 'the Key is closed').toBe(false);
      expect(m.play, 'Play is drawn').not.toBeNull();
      expect(m.play!.bottom, 'Play ends inside the first screen').toBeLessThanOrEqual(
        m.viewport.height,
      );
    });
  }
});

// ── 2. phones: a Key disclosure, closed when the page opens ──────────────────

for (const viewport of PHONES) {
  for (const text of ['normal', '200%'] as const) {
    test.describe(`2. the Key on a phone at ${viewport.width}x${viewport.height}, ${text} text`, () => {
      test.use({ viewport });

      async function openSized(page: Page) {
        await openReplay(page);
        if (text === '200%') {
          await page.evaluate(() => {
            document.documentElement.style.fontSize = '200%';
          });
          await settle(page);
        }
      }

      test('is closed when the page opens, its summary is a full-size target, and the key stays in the document', async ({
        page,
      }) => {
        await openSized(page);
        const m = await layout(page);
        expect(m.legendTag, 'the legend is a native disclosure').toBe('details');
        expect(m.legendOpen, 'closed by default').toBe(false);
        const summary = page.locator('details[data-replay-legend] > summary');
        await expect(summary).toBeVisible();
        await expect(summary).toHaveText(/key/i);
        const box = (await summary.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(TARGET_MIN - EDGE);
        expect(box.width).toBeGreaterThanOrEqual(TARGET_MIN - EDGE);
        // What the transcript points at is still there while it is closed.
        expect(m.describedTargets).toBe(1);
        expect(m.describedInLegend).toBe(true);
        await expect(page.locator('#replay-key')).toBeHidden();
      });

      test('the terminal is at most 45% of the screen, with the Key closed and with it open', async ({
        page,
      }) => {
        await openSized(page);
        const closed = await layout(page);
        expect(closed.terminal.height / closed.viewport.height).toBeLessThanOrEqual(0.45 + 0.002);
        await page.locator('details[data-replay-legend] > summary').click();
        await settle(page);
        const open = await layout(page);
        expect(open.legendOpen).toBe(true);
        await expect(page.locator('#replay-key')).toBeVisible();
        expect(open.terminal.height / open.viewport.height).toBeLessThanOrEqual(0.45 + 0.002);
        // Still directly above the terminal, and nothing is pushed sideways.
        expect(open.legend!.bottom).toBeLessThanOrEqual(open.terminal.top + EDGE);
        expect(open.sideways).toBeLessThanOrEqual(0);
      });

      test('it opens with a tap, with Enter and with Space, and adds no live region', async ({
        page,
      }) => {
        await openSized(page);
        const details = page.locator('details[data-replay-legend]');
        const summary = details.locator('> summary');
        const isOpen = () => details.evaluate((el) => (el as HTMLDetailsElement).open);
        await summary.click();
        expect(await isOpen()).toBe(true);
        await summary.focus();
        await page.keyboard.press('Enter');
        expect(await isOpen()).toBe(false);
        await page.keyboard.press('Space');
        expect(await isOpen()).toBe(true);
        const live = await details.evaluate((el) => {
          const LIVE =
            '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"], output';
          return el.matches(LIVE) || el.querySelector(LIVE) !== null || el.closest(LIVE) !== null;
        });
        expect(live).toBe(false);
      });

      if (text === 'normal') {
        test('Play is no lower than it was: one screen-cap of terminal under the stage’s own padding', async ({
          page,
        }) => {
          await openSized(page);
          const m = await layout(page);
          // On main the terminal started one top padding into the stage, was at
          // most 45% of the screen tall, and Play followed one gap under it.
          // With the Key closed above the terminal, Play starts no further down.
          const asOnMain = m.stagePadTop + 0.45 * m.viewport.height + m.stageGap;
          expect(m.play, 'Play is drawn').not.toBeNull();
          expect(m.transport!.top - m.stage.top).toBeLessThanOrEqual(asOnMain + EDGE);
        });
      }
    });
  }
}

test.describe('2. Connect on a phone, with a run open', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the run bar is on screen when the page opens, and Connect draws no transcript terminal', async ({
    page,
  }) => {
    test.skip(!FIXTURES_BUILT, NO_FIXTURES);
    await suppressBootSplash(page);
    await page.goto('/e2e/connect-states?state=connected');
    await page.getByRole('button', { name: /^LIVE/ }).click();
    await page.getByRole('button', { name: /start a run/i }).click();
    const bar = page.getByRole('region', { name: /what we have recorded so far/i });
    await expect(bar).toBeVisible();
    await settle(page);
    const m = await page.evaluate(() => {
      const dock = document.querySelector('section[aria-labelledby="connect-state"]')!;
      const r = dock.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        height: innerHeight,
        transcripts: document.querySelectorAll('ol[aria-label="Attack replay step timeline"]')
          .length,
        legends: document.querySelectorAll('[data-replay-legend]').length,
      };
    });
    expect(m.top).toBeGreaterThanOrEqual(-EDGE);
    expect(m.bottom).toBeLessThanOrEqual(m.height + EDGE);
    // The live console has no transcript of its own: a live run's transcript is
    // its replay at /runs/[id], the component measured above.
    expect(m.transcripts).toBe(0);
    expect(m.legends).toBe(0);
  });
});

// ── 3. every handle opens its definition ─────────────────────────────────────

const handlesIn = (page: Page) =>
  page.locator('ol[aria-label="Attack replay step timeline"] details[data-speaker-handle]');

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const) {
  test.describe(`3. speaker handles at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ page, browserName }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await openReplay(page);
      await toEnd(page);
    });

    test('every handle drawn has an entry in the roles lookup, and is named for it', async ({
      page,
    }) => {
      const all = page.locator('details[data-speaker-handle]');
      const drawn = await all.evaluateAll((nodes) =>
        nodes
          .filter((node) => node.getBoundingClientRect().width > 0 || node.querySelector('summary'))
          .map((node) => ({
            handle: node.getAttribute('data-speaker-handle')!,
            name: node.querySelector('summary')!.getAttribute('aria-label'),
          })),
      );
      expect(drawn.length).toBeGreaterThan(2);
      const known = Object.values(ROLES);
      for (const { handle, name } of drawn) {
        expect(known, handle).toContain(roleForHandle(handle));
        expect(name).toBe(handleName(handle));
      }
      expect(new Set(drawn.map((d) => d.handle))).toEqual(
        new Set(['user@console', 'target-agent@sentinel', 'detector@sentinel']),
      );
      await expect(handlesIn(page).nth(1).locator('summary')).toHaveAttribute(
        'aria-label',
        'target-agent at sentinel, Agent under test',
      );
    });

    test('a press opens the definition inside the terminal and the screen, and does not move the playhead', async ({
      page,
    }) => {
      const readout = page.getByText(/^STEP \d\d/).filter({ visible: true });
      const before = await readout.first().innerText();
      const handle = handlesIn(page).nth(1);
      await handle.locator('summary').scrollIntoViewIfNeeded();
      await handle.locator('summary').click();
      await settle(page);
      const panel = handle.locator('[data-speaker-panel]');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('Agent under test. The AI agent this run tests.');
      expect(await readout.first().innerText()).toBe(before);

      const m = await panel.evaluate((el) => {
        const list = document.querySelector('ol[aria-label="Attack replay step timeline"]')!;
        const terminal = list.parentElement as HTMLElement;
        const t = terminal.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const centre = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          panel: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
          terminal: { top: t.top, bottom: t.bottom, left: t.left, right: t.right },
          onTop: Boolean(centre && el.contains(centre)),
          width: innerWidth,
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          live: el.closest('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"]')
            ? true
            : false,
        };
      });
      // Drawn in the flow of the terminal, under its row: inside the box that
      // scrolls, inside the screen, and not cut off or covered.
      expect(m.panel.left).toBeGreaterThanOrEqual(m.terminal.left - EDGE);
      expect(m.panel.right).toBeLessThanOrEqual(m.terminal.right + EDGE);
      expect(m.panel.top).toBeGreaterThanOrEqual(m.terminal.top - EDGE);
      expect(m.panel.bottom).toBeLessThanOrEqual(m.terminal.bottom + EDGE);
      expect(m.panel.right).toBeLessThanOrEqual(m.width + EDGE);
      expect(m.onTop, 'the definition is not covered or clipped').toBe(true);
      expect(m.sideways).toBeLessThanOrEqual(0);
      expect(m.live).toBe(false);
    });

    test('Enter and Space open it, Escape closes it and gives focus back', async ({ page }) => {
      const handle = handlesIn(page).nth(1);
      const summary = handle.locator('summary');
      const isOpen = () => handle.evaluate((el) => (el as HTMLDetailsElement).open);
      await summary.focus();
      await page.keyboard.press('Enter');
      expect(await isOpen()).toBe(true);
      await page.keyboard.press('Escape');
      expect(await isOpen()).toBe(false);
      await expect(summary).toBeFocused();
      await page.keyboard.press('Space');
      expect(await isOpen()).toBe(true);
      // From inside the definition too: the link in it has focus, Escape
      // closes and focus goes back to the handle.
      await handle.locator('a').focus();
      await page.keyboard.press('Escape');
      expect(await isOpen()).toBe(false);
      await expect(summary).toBeFocused();
      // The handle shows the shared focus ring.
      const ring = await summary.evaluate((el) => {
        const s = getComputedStyle(el);
        return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      });
      expect(ring).toBe(true);
    });

    test('one is open at a time, and a press outside closes it', async ({ page }) => {
      const open = () =>
        page
          .locator('details[data-speaker-handle]')
          .evaluateAll((nodes) =>
            nodes
              .filter((node) => (node as HTMLDetailsElement).open)
              .map((node) => node.getAttribute('data-speaker-handle')),
          );
      const first = handlesIn(page).nth(0).locator('summary');
      const second = handlesIn(page).nth(1).locator('summary');
      await first.scrollIntoViewIfNeeded();
      await first.click();
      expect(await open()).toEqual(['user@console']);
      await second.scrollIntoViewIfNeeded();
      await second.click();
      expect(await open()).toEqual(['target-agent@sentinel']);
      await page.locator('section[aria-label="Step detail"]').click({ position: { x: 5, y: 5 } });
      expect(await open()).toEqual([]);
    });

    test('a handle is a full-size target that stays inside its own row', async ({ page }) => {
      const boxes = await handlesIn(page).evaluateAll((nodes) =>
        nodes.map((node) => {
          const s = node.querySelector('summary')!.getBoundingClientRect();
          const row = node.closest('li')!.getBoundingClientRect();
          return {
            width: s.width,
            height: s.height,
            inRow: s.top >= row.top - 1 && s.bottom <= row.bottom + 1,
          };
        }),
      );
      expect(boxes.length).toBeGreaterThan(1);
      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(TARGET_MIN - EDGE);
        expect(box.height).toBeGreaterThanOrEqual(TARGET_MIN - EDGE);
        expect(box.inRow, 'its hit area does not reach a neighbouring row').toBe(true);
      }
    });

    test('pressing the rest of a row still selects the step', async ({ page }) => {
      // The row of the second handle: a step that is not the current one.
      const row = handlesIn(page).nth(1).locator('xpath=..').locator('> button');
      await expect(row).not.toHaveAttribute('aria-current', 'step');
      await row.scrollIntoViewIfNeeded();
      await settle(page);
      const box = (await row.boundingBox())!;
      // The right-hand end of the row, clear of the handle at its start.
      await page.mouse.click(box.x + box.width - 6, box.y + box.height - 6);
      await expect(row).toHaveAttribute('aria-current', 'step');
    });

    test('the detector’s prompt on the verdict rail opens its definition too', async ({ page }) => {
      const rail = page.getByRole('complementary', { name: 'Detector verdict' });
      const handle = rail.locator('details[data-speaker-handle="detector@sentinel"]').first();
      await handle.locator('summary').scrollIntoViewIfNeeded();
      await handle.locator('summary').click();
      const panel = handle.locator('[data-speaker-panel]');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(
        'MCProof detector. Flags the step where the agent is compromised, if it is.',
      );
      const inside = await panel.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const box = el.closest('aside')!.getBoundingClientRect();
        return r.left >= box.left - 1 && r.right <= box.right + 1 && r.right <= innerWidth + 1;
      });
      expect(inside).toBe(true);
    });
  });
}

test.describe('3. axe on the replay with a definition open', () => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ] as const) {
    test.describe(`${viewport.width}x${viewport.height}`, () => {
      test.use({ viewport });

      test('zero WCAG A/AA violations, closed, with the Key open and with a definition open', async ({
        page,
        browserName,
      }) => {
        test.skip(browserName === 'webkit', 'axe is run in Chromium.');
        await openReplay(page);
        await expectNoWcagViolations(page);
        await toEnd(page);
        await page.locator('details[data-replay-legend] > summary').click();
        await handlesIn(page).nth(1).locator('summary').click();
        await settle(page);
        await expectNoWcagViolations(page);
      });
    });
  }
});

// ── 4. the glossary, and the first @sentinel ─────────────────────────────────

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
] as const) {
  test.describe(`4. the glossary at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('the entry for Sentinel is the exact sentence', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await suppressBootSplash(page);
      await page.goto('/threats');
      const definition = page.locator('#sentinel dd');
      await expect(definition).toBeVisible();
      expect(await definition.innerText()).toBe(
        "Sentinel is MCProof's proving ground: a sealed test environment where your agent meets booby-trapped tools while our detector watches.",
      );
      expect(SENTINEL_GLOSSARY_TEXT).toBe(await definition.innerText());
      expect(
        await definition.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(16);
    });

    for (const run of ['sample', 'asi06-run'] as const) {
      test(`/runs/${run}: the first "@sentinel" is a link to it, and the keyboard can follow it`, async ({
        page,
        browserName,
      }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        await openReplay(page, run);
        // The first "@sentinel" in the document, wherever it is drawn.
        const first = await page.evaluate(() => {
          const walker = document.createTreeWalker(
            document.querySelector('main') ?? document.body,
            NodeFilter.SHOW_TEXT,
          );
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!(node.textContent ?? '').includes('@sentinel')) continue;
            const link = node.parentElement!.closest('a');
            return { href: link?.getAttribute('href') ?? null, text: link?.textContent ?? null };
          }
          return null;
        });
        expect(first, 'an @sentinel is in the document').not.toBeNull();
        expect(first!.href).toBe(SENTINEL_GLOSSARY_HREF);
        expect(first!.text).toBe('@sentinel');

        // It is inside the Key, closed at every width, so the Key is opened first.
        const summary = page.locator('details[data-replay-legend] > summary');
        await summary.focus();
        await page.keyboard.press('Enter');
        const link = page
          .locator(`[data-replay-legend] a[href="${SENTINEL_GLOSSARY_HREF}"]`)
          .filter({ visible: true });
        await expect(link).toHaveCount(1);
        await link.focus();
        await expect(link).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/threats#sentinel$/);
        const entry = page.locator('#sentinel');
        await expect(entry).toBeVisible();
        await expect(entry.locator('dd')).toHaveText(SENTINEL_GLOSSARY_TEXT);
        await expect(entry).toBeInViewport();
      });
    }

    test('the first sentinel handle in the transcript carries the same link in its definition', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await openReplay(page);
      await toEnd(page);
      const handle = page
        .locator(
          'ol[aria-label="Attack replay step timeline"] details[data-speaker-handle$="@sentinel"]',
        )
        .first();
      await handle.locator('summary').focus();
      await page.keyboard.press('Enter');
      const link = handle.locator(`a[href="${SENTINEL_GLOSSARY_HREF}"]`);
      await expect(link).toBeVisible();
      // The next stop after the handle. WebKit's Tab leaves links out of the
      // order unless the reader has asked for them, so there the keyboard is
      // put on the link directly.
      if (browserName === 'webkit') await link.focus();
      else await page.keyboard.press('Tab');
      await expect(link).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/threats#sentinel$/);
    });
  });
}

// ── 5. "Sentinel Fields" is on no page ───────────────────────────────────────

const EVERY_PAGE = [
  '/',
  '/connect',
  '/findings/sample',
  '/findings/asi10-goal-drift',
  '/leaderboard',
  '/threats',
  '/sign-in',
  '/account',
  '/no-such-page',
  '/runs/no-such-run',
  ...SAMPLE_RUNS.map((run) => `/runs/${run}`),
];
const FIXTURE_PAGES = [
  '/e2e/connect-states?state=waiting',
  '/e2e/header-states?mode=live',
  '/e2e/header-states?mode=sample',
];

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 1099, height: 900 },
  { width: 390, height: 844 },
] as const) {
  test.describe(`5. "Sentinel Fields" at ${viewport.width}`, () => {
    test.use({ viewport });

    test('is in the text, the title and the metadata of no page', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      test.slow();
      const found: string[] = [];
      const pages = FIXTURES_BUILT ? [...EVERY_PAGE, ...FIXTURE_PAGES] : EVERY_PAGE;
      for (const path of pages) {
        // The boot splash is left on for the front door, so its words count.
        if (path !== '/') await suppressBootSplash(page);
        await page.goto(path);
        await page.waitForLoadState('domcontentloaded');
        const words = await page.evaluate(() =>
          [
            document.documentElement.innerText,
            document.body.textContent ?? '',
            document.title,
            ...[...document.querySelectorAll('meta[content]')].map(
              (meta) => meta.getAttribute('content') ?? '',
            ),
            ...[...document.querySelectorAll('[aria-label], [title], [alt]')].map(
              (el) =>
                `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''} ${el.getAttribute('alt') ?? ''}`,
            ),
          ].join('\n'),
        );
        if (/sentinel\s*fields/i.test(words)) found.push(path);
      }
      expect(found, 'pages that still say "Sentinel Fields"').toEqual([]);
    });
  });
}

// ── 6. nothing in the verdict rail or the nav rail is cut off ────────────────

for (const width of [1024, 1280, 1440] as const) {
  for (const font of ['loaded font', 'fallback font'] as const) {
    test.describe(`6. no clipped text at ${width}, ${font}`, () => {
      test.use({ viewport: { width, height: 900 } });

      for (const run of ['sample', 'asi03-identity-privilege-abuse', 'asi05-code-execution']) {
        test(`/runs/${run}: the verdict rail and the nav rail hold their text`, async ({
          page,
          browserName,
        }) => {
          test.skip(browserName === 'webkit', WEBKIT_IS_A_PHONE);
          if (font === 'fallback font') {
            await page.context().route(/\.woff2?(\?|$)/, (route) => route.abort());
          }
          await openReplay(page, run);
          const m = await page.evaluate(() => {
            const cut: string[] = [];
            const check = (root: Element, name: string) => {
              const edge = root.getBoundingClientRect();
              for (const el of [root, ...root.querySelectorAll('*')] as HTMLElement[]) {
                if (el.getClientRects().length === 0) continue;
                const style = getComputedStyle(el);
                const words = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
                if (style.display !== 'inline' && el.scrollWidth > el.clientWidth) {
                  cut.push(`${name}: "${words}" scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
                }
                if (style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) {
                  cut.push(`${name}: "${words}" ends in an ellipsis`);
                }
                const r = el.getBoundingClientRect();
                if (words && r.right > edge.right + 1) {
                  cut.push(`${name}: "${words}" runs ${Math.round(r.right - edge.right)}px past`);
                }
              }
            };
            const rail = document.querySelector('aside[aria-label="Detector verdict"]')!;
            check(rail, 'verdict rail');
            const navs = [...document.querySelectorAll('nav')].filter(
              (nav) => nav.getClientRects().length > 0,
            );
            for (const nav of navs) check(nav, `nav "${nav.getAttribute('aria-label')}"`);
            return {
              cut,
              navs: navs.length,
              rail: (rail as HTMLElement).innerText,
            };
          });
          expect(m.navs, 'a nav rail is drawn').toBeGreaterThan(0);
          expect(m.cut, 'text that is cut off or runs past its panel').toEqual([]);
          // The whole of each line is there, not a shortened one.
          expect(m.rail).toMatch(/export (fix report|run result)\?/);
          expect(m.rail).toMatch(/category\s+ASI\d\d \S+/);
        });
      }
    });
  }
}

// ── 7. Home: how a test works ────────────────────────────────────────────────

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
] as const) {
  test.describe(`7. how a test works, on Home at ${viewport.width}`, () => {
    test.use({ viewport });

    test('five steps in order, readable, and the calls to action are where they were', async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
      await suppressBootSplash(page);
      await page.goto('/');
      await expect(page.locator('h1').first()).toBeVisible();
      await settle(page);
      const strip = page.getByTestId('how-a-test-works');
      await expect(strip).toBeVisible();
      await expect(strip.getByRole('heading', { name: 'How a test works' })).toBeVisible();
      const items = strip.locator('ol > li');
      await expect(items).toHaveCount(5);
      await expect(items.locator('[data-step-text]')).toHaveText([
        'The operator (the person giving the agent a normal task) gives a task',
        'The agent uses the served tools (tools we host for the run)',
        'In an attack run, one served tool carries the attack. In a control run, none does, so you can see how the agent behaves with no attack.',
        'The detector reads every step',
        'You get a fix report or a clean result',
      ]);

      const m = await strip.evaluate((el) => {
        const rect = (node: Element) => {
          const r = node.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        };
        const cta = [...document.querySelectorAll('main a')].find((a) =>
          /connect your agent/i.test(a.textContent ?? ''),
        )!;
        const items = [...el.querySelectorAll('ol > li')];
        return {
          strip: rect(el),
          cta: rect(cta),
          items: items.map(rect),
          sizes: items.map((item) =>
            parseFloat(getComputedStyle(item.querySelector('[data-step-text]')!).fontSize),
          ),
          arrowsHidden: [...el.querySelectorAll('[data-step-arrow]')].every(
            (arrow) => arrow.closest('[aria-hidden="true"]') !== null,
          ),
          animations: el.getAnimations({ subtree: true }).length,
          width: innerWidth,
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(m.arrowsHidden).toBe(true);
      expect(m.animations, 'no new motion').toBe(0);
      for (const size of m.sizes) expect(size).toBeGreaterThanOrEqual(16);
      expect(m.strip.right).toBeLessThanOrEqual(m.width + EDGE);
      expect(m.sideways).toBeLessThanOrEqual(0);
      if (viewport.width < 768) {
        // Stacked: each step under the one before it.
        for (let i = 1; i < m.items.length; i += 1) {
          expect(m.items[i]!.top).toBeGreaterThanOrEqual(m.items[i - 1]!.bottom - EDGE);
        }
        // It comes after the calls to action, so it pushes neither of them down.
        expect(m.strip.top).toBeGreaterThanOrEqual(m.cta.bottom - EDGE);
      } else {
        // In the other column: beside the pitch, not above its calls to action.
        expect(m.strip.left).toBeGreaterThanOrEqual(m.cta.right - EDGE);
      }
    });
  });
}
