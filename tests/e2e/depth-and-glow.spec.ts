import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { suppressBootSplash } from './support/screen';
import {
  installAudit,
  probeContrast,
  probeContrastOf,
  type ContrastPair,
} from './support/ui-audit';

/**
 * DEPTH AND GLOW (UI audit 2026-10-13, batch F).
 *
 * Measured in a real browser on the five pages of the audit (Home, Connect, a
 * report, the sample replay, Sign in), at a phone width and a desk width:
 *
 *  1. DEPTH. The Home replay card, the Home figures card and the report's
 *     summary card are painted on the raised surface and cast `--elev-1`; the
 *     replay terminal casts `--elev-2`. Nothing nested casts a second shadow.
 *     Under 768px both elevations are lighter: less blur and less ink.
 *
 *  2. GLOW. A primary or an outlined button has no shadow at rest. Under the
 *     pointer, and under the keyboard, it takes `--glow-accent`, and under the
 *     keyboard the shared focus ring is still there beside it. A disabled one
 *     never glows. The fade is at most 150ms and is switched off under
 *     `prefers-reduced-motion: reduce`. Nothing animates a glow.
 *
 *  3. TEXT. No text casts a shadow, and text is still at least 4.5:1 against
 *     what is under it, the raised surface included (axe `color-contrast` with
 *     zero violations, and every node axe could not decide computed here).
 *
 * Every expected value is read back from the page's own tokens, so no shadow
 * is spelled out here, and no size is asserted except as "less than".
 *
 * WebKit runs this at the phone width only. It has no pointer that hovers, and
 * Playwright's Windows WebKit crashes inside axe's contrast rule, so those two
 * checks are Chromium's.
 */

const TEXT_MIN = 4.5;
const DISABLED_MIN = 3;
const RING_MIN_WIDTH = 2;
/** The longest a hover fade may take, in seconds. */
const FADE_MAX = 0.15;

const PHONE = { width: 390, height: 844 } as const;
const DESK = { width: 1280, height: 800 } as const;
const VIEWPORTS = [PHONE, DESK] as const;

const PAGES = [
  { name: 'Home', path: '/' },
  { name: 'Connect', path: '/connect' },
  { name: 'Report', path: '/findings/sample' },
  { name: 'Replay', path: '/runs/sample' },
  { name: 'Sign in', path: '/sign-in' },
] as const;

const WEBKIT_IS_A_PHONE = 'WebKit stands in for an iPhone: it is measured at the phone width.';

/** Let web fonts land and every finite animation finish, so the page is at rest. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

async function open(page: Page, path: string) {
  await suppressBootSplash(page);
  await page.goto(path);
  await expect(page.locator('h1').first()).toBeVisible();
  await settle(page);
}

/** What the page's own tokens compute to, read off a throwaway element. */
function readTokens(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    document.body.append(probe);
    const shadow = (token: string) => {
      probe.style.boxShadow = `var(${token})`;
      return getComputedStyle(probe).boxShadow;
    };
    const tokens = {
      elev1: shadow('--elev-1'),
      elev2: shadow('--elev-2'),
      glow: shadow('--glow-accent'),
      raised: (() => {
        probe.style.backgroundColor = 'var(--surface-raised)';
        return getComputedStyle(probe).backgroundColor;
      })(),
    };
    probe.remove();
    return tokens;
  });
}

interface Layer {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  alpha: number;
}

/** A computed box-shadow as its layers. Computed values are always in px. */
function layersOf(computed: string): Layer[] {
  if (computed === 'none' || computed === '') return [];
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  [...computed].forEach((ch, i) => {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(computed.slice(start, i));
      start = i + 1;
    }
  });
  parts.push(computed.slice(start));
  return parts.map((part) => {
    const colour = part.match(/[a-z-]+\([^)]*\)/i)?.[0] ?? '';
    const slash = colour.match(/\/\s*([\d.]+%?)\s*\)/)?.[1];
    const fourth = colour.match(/^rgba\((?:[^,]+,){3}\s*([\d.]+)\s*\)/)?.[1];
    const raw = slash ?? fourth ?? '1';
    const alpha = raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw);
    const lengths = (part.replace(colour, ' ').match(/-?[\d.]+px/g) ?? []).map(parseFloat);
    return {
      inset: /\binset\b/.test(part),
      x: lengths[0] ?? 0,
      y: lengths[1] ?? 0,
      blur: lengths[2] ?? 0,
      spread: lengths[3] ?? 0,
      alpha,
    };
  });
}

const cast = (layers: Layer[]) => layers.filter((layer) => !layer.inset);
const deepestBlur = (layers: Layer[]) => Math.max(0, ...cast(layers).map((layer) => layer.blur));
const darkest = (layers: Layer[]) => Math.max(0, ...cast(layers).map((layer) => layer.alpha));

/** The card around the Home figures: the one ancestor both groups share. */
const HOME_HERO = 'main [role="img"]:has([data-testid="hero-step"])';
const REPORT_SUMMARY = 'main section[aria-label="Summary"]';
const TERMINAL = 'main :has(> ol[aria-label="Attack replay step timeline"])';

function readBox(locator: Locator) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      shadow: style.boxShadow,
      background: style.backgroundColor,
      level: el.getAttribute('data-elev'),
      // Nothing lifted sits inside something lifted and casts a second shadow.
      stacked: [...el.querySelectorAll('[data-elev]')]
        .filter((inner) => getComputedStyle(inner).boxShadow !== 'none')
        .map((inner) => inner.tagName.toLowerCase()),
      insideLifted: el.parentElement?.closest('[data-elev]') !== null,
    };
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`depth at ${viewport.width}px`, () => {
    test.use({ viewport });
    test.beforeEach(({ browserName }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
    });

    test('Home: the replay card and the figures card are raised and cast --elev-1', async ({
      page,
    }) => {
      await open(page, '/');
      const tokens = await readTokens(page);
      expect(tokens.elev1, '--elev-1 resolves to a shadow').not.toBe('none');

      const hero = await readBox(page.locator(HOME_HERO));
      expect(hero.shadow, 'the replay card').toBe(tokens.elev1);
      expect(hero.background, 'the replay card').toBe(tokens.raised);
      expect(hero.stacked).toEqual([]);
      expect(hero.insideLifted).toBe(false);

      // ONE card around both groups of figures, not a card for each.
      const groups = page.locator('main [data-metric-group]');
      await expect(groups).toHaveCount(2);
      const cards = await groups.evaluateAll((all) =>
        all.map((group) => {
          const card = group.closest('[data-elev]');
          return card ? [...document.querySelectorAll('[data-elev]')].indexOf(card) : -1;
        }),
      );
      expect(cards[0], 'the figures sit in a card').toBeGreaterThanOrEqual(0);
      expect(new Set(cards).size, 'both groups in the same card').toBe(1);
      const figures = await readBox(
        page.locator('main [data-elev]:has([data-metric-group="compromise"])'),
      );
      expect(figures.shadow, 'the figures card').toBe(tokens.elev1);
      expect(figures.background, 'the figures card').toBe(tokens.raised);
      expect(figures.stacked).toEqual([]);
      expect(figures.insideLifted).toBe(false);
    });

    test('Report: the summary card is raised and casts --elev-1', async ({ page }) => {
      await open(page, '/findings/sample');
      const tokens = await readTokens(page);
      const summary = await readBox(page.locator(REPORT_SUMMARY));
      expect(summary.shadow).toBe(tokens.elev1);
      expect(summary.background).toBe(tokens.raised);
      expect(summary.stacked).toEqual([]);
    });

    test('Replay: the terminal casts --elev-2, whole, and nothing is pushed sideways', async ({
      page,
    }) => {
      await open(page, '/runs/sample');
      const tokens = await readTokens(page);
      expect(tokens.elev2, '--elev-2 resolves to a shadow').not.toBe('none');
      expect(tokens.elev2, 'the terminal is lifted further than a card').not.toBe(tokens.elev1);

      const terminal = page.locator(TERMINAL);
      await expect(terminal).toHaveCount(1);
      expect((await readBox(terminal)).shadow).toBe(tokens.elev2);

      // A shadow is cut into a hard line by an ancestor that clips. The
      // terminal scrolls inside itself (that clips its lines, never its own
      // shadow), so what matters is every box AROUND it that clips: its edge
      // has to be further from the terminal than the shadow reaches. The reach
      // is read off the token (offset, blur and spread), over-estimated.
      const reach = layersOf(tokens.elev2)
        .filter((layer) => !layer.inset)
        .reduce(
          (most, layer) => ({
            x: Math.max(most.x, Math.abs(layer.x) + layer.blur + layer.spread),
            down: Math.max(most.down, layer.y + layer.blur + layer.spread),
          }),
          { x: 0, down: 0 },
        );
      const clipping = await terminal.evaluate((el, reach) => {
        const found: string[] = [];
        const box = el.getBoundingClientRect();
        for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
          const style = getComputedStyle(up);
          if (style.display === 'contents') continue;
          const edge = up.getBoundingClientRect();
          const name = up.tagName.toLowerCase();
          if (style.overflowX !== 'visible') {
            const room = Math.min(box.left - edge.left, edge.right - box.right);
            if (room < reach.x) found.push(`${name} clips sideways ${room}px from the terminal`);
          }
          if (style.overflowY !== 'visible') {
            const room = edge.bottom - box.bottom;
            if (room < reach.down) found.push(`${name} clips ${room}px under the terminal`);
          }
        }
        return found;
      }, reach);
      expect(clipping, 'boxes that would cut the shadow off').toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'sideways scroll').toBeLessThanOrEqual(0);
    });
  });
}

test.describe('the elevation is lighter on a phone', () => {
  test('at 390px both shadows have less blur and less ink than at 1280px', async ({ page }) => {
    await page.setViewportSize(DESK);
    await open(page, '/runs/sample');
    const desk = await readTokens(page);
    const deskTerminal = (await readBox(page.locator(TERMINAL))).shadow;

    await page.setViewportSize(PHONE);
    await settle(page);
    const phone = await readTokens(page);
    const phoneTerminal = (await readBox(page.locator(TERMINAL))).shadow;

    for (const key of ['elev1', 'elev2'] as const) {
      expect(phone[key], `${key} at 390`).not.toBe('none');
      expect(phone[key], `${key} differs between the two widths`).not.toBe(desk[key]);
      expect(deepestBlur(layersOf(phone[key])), `${key} blur`).toBeLessThan(
        deepestBlur(layersOf(desk[key])),
      );
      expect(darkest(layersOf(phone[key])), `${key} alpha`).toBeLessThan(
        darkest(layersOf(desk[key])),
      );
    }
    // And the component follows the token: it never branches by width itself.
    expect(deskTerminal).toBe(desk.elev2);
    expect(phoneTerminal).toBe(phone.elev2);
  });
});

/** A primary or outlined button, found the way a reader finds it. */
interface Control {
  page: string;
  path: string;
  kind: 'primary' | 'outlined';
  find: (page: Page) => Locator;
}

const CONTROLS: Control[] = [
  {
    page: 'Home',
    path: '/',
    kind: 'primary',
    find: (page) => page.locator('main').getByRole('link', { name: /^Play \S+ sample$/ }),
  },
  {
    page: 'Home',
    path: '/',
    kind: 'outlined',
    find: (page) => page.locator('main').getByRole('link', { name: /^connect your agent/i }),
  },
  {
    page: 'Connect',
    path: '/connect',
    kind: 'primary',
    find: (page) => page.locator('main').getByRole('link', { name: /play sample run/i }),
  },
  {
    page: 'Replay',
    path: '/runs/sample',
    kind: 'primary',
    find: (page) =>
      page.getByRole('button', { name: 'Play', exact: true }).filter({ visible: true }),
  },
  {
    page: 'Sign in',
    path: '/sign-in',
    kind: 'primary',
    find: (page) => page.getByRole('button', { name: /email me a code/i }),
  },
];

const readControl = (locator: Locator) =>
  locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      shadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      focusVisible: el.matches(':focus-visible'),
      durations: style.transitionDuration.split(',').map((d) => parseFloat(d)),
      properties: style.transitionProperty.split(',').map((p) => p.trim()),
    };
  });

/**
 * Read a control once its fade has finished. The fade is a transition, and a
 * transition is an animation the element can be asked about, so this waits for
 * the element's own animations to end and never for a length of time. (Two
 * equal readings a moment apart is not the same thing: WebKit can report the
 * first frame of a fade twice before it has drawn the second.)
 */
async function atRest(locator: Locator) {
  await locator.evaluate(async (el) => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => null)));
  });
  return readControl(locator);
}

/** Put the keyboard on a control: one real key so focus is keyboard focus, then the control. */
async function keyboardFocus(page: Page, locator: Locator) {
  await page.keyboard.press('Tab');
  await locator.evaluate((el) => (el as HTMLElement).focus());
}

for (const viewport of VIEWPORTS) {
  test.describe(`the button glow at ${viewport.width}px`, () => {
    test.use({ viewport });
    test.beforeEach(({ browserName }) => {
      test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
    });

    for (const control of CONTROLS) {
      test(`${control.page}, the ${control.kind} button: nothing at rest, the glow and the ring under the keyboard`, async ({
        page,
      }) => {
        await open(page, control.path);
        const tokens = await readTokens(page);
        expect(tokens.glow, '--glow-accent resolves to a shadow').not.toBe('none');
        const button = control.find(page);
        await expect(button).toHaveCount(1);

        const rest = await atRest(button);
        expect(rest.shadow, 'at rest').toBe('none');
        // The fade: the shadow is one of the things that moves, and it is quick.
        expect(rest.properties, 'what fades').toContain('box-shadow');
        expect(Math.max(...rest.durations), 'the fade, in seconds').toBeLessThanOrEqual(FADE_MAX);
        expect(Math.max(...rest.durations), 'there is a fade').toBeGreaterThan(0);

        await keyboardFocus(page, button);
        const focused = await atRest(button);
        expect(focused.focusVisible, 'the keyboard is on it').toBe(true);
        expect(focused.shadow, 'under the keyboard').toBe(tokens.glow);
        // Together with the shared ring, never in place of it.
        expect(focused.outlineStyle, 'the ring').toBe('solid');
        expect(focused.outlineWidth, 'the ring').toBeGreaterThanOrEqual(RING_MIN_WIDTH);

        await button.evaluate((el) => (el as HTMLElement).blur());
        expect((await atRest(button)).shadow, 'after the keyboard has left').toBe('none');
      });

      test(`${control.page}, the ${control.kind} button: the glow under the pointer`, async ({
        page,
        browserName,
      }) => {
        test.skip(browserName !== 'chromium', 'Chromium only: a phone has no pointer that hovers.');
        test.skip(viewport.width < 768, 'Hover is measured at the desk width.');
        await open(page, control.path);
        const tokens = await readTokens(page);
        expect(tokens.glow, '--glow-accent resolves to a shadow').not.toBe('none');
        const button = control.find(page);
        await button.scrollIntoViewIfNeeded();

        await button.hover();
        expect((await atRest(button)).shadow, 'under the pointer').toBe(tokens.glow);
        await page.mouse.move(0, 0);
        expect((await atRest(button)).shadow, 'after the pointer has left').toBe('none');
      });

      test(`${control.page}, the ${control.kind} button: disabled, it never glows`, async ({
        page,
        browserName,
      }) => {
        await open(page, control.path);
        const button = control.find(page);
        // The page's own disabled states need an account or a call in flight,
        // so the control is disabled here the way the app disables it: the
        // attribute on a button, aria-disabled on a link.
        await button.evaluate((el) => {
          if (el instanceof HTMLButtonElement) el.disabled = true;
          else el.setAttribute('aria-disabled', 'true');
        });
        if (browserName === 'chromium' && viewport.width >= 768) {
          await button.scrollIntoViewIfNeeded();
          await button.hover({ force: true });
          expect((await atRest(button)).shadow, 'disabled, under the pointer').toBe('none');
        }
        await keyboardFocus(page, button);
        expect((await atRest(button)).shadow, 'disabled, focused').toBe('none');
      });

      test(`${control.page}, the ${control.kind} button: no fade with reduced motion`, async ({
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await open(page, control.path);
        const tokens = await readTokens(page);
        const button = control.find(page);
        const rest = await readControl(button);
        // Either nothing is transitioned at all, or it takes no time.
        const none = rest.properties.every((p) => p === 'none');
        expect(
          none || Math.max(...rest.durations) < 0.001,
          `transition ${rest.properties.join(',')} over ${rest.durations.join(',')}s`,
        ).toBe(true);
        // The glow itself is still there: it only stops fading.
        await keyboardFocus(page, button);
        expect((await readControl(button)).shadow).toBe(tokens.glow);
      });
    }

    test('Report: a secondary button does not glow', async ({ page, browserName }) => {
      await open(page, '/findings/sample');
      const copy = page.getByRole('button', { name: /copy report/i });
      await expect(copy).toHaveCount(1);
      expect((await atRest(copy)).shadow).toBe('none');
      await keyboardFocus(page, copy);
      const focused = await atRest(copy);
      expect(focused.focusVisible).toBe(true);
      expect(focused.shadow, 'under the keyboard').toBe('none');
      if (browserName === 'chromium' && viewport.width >= 768) {
        await copy.hover();
        expect((await atRest(copy)).shadow, 'under the pointer').toBe('none');
      }
    });
  });
}

const line = (pair: ContrastPair) =>
  `${pair.ratio}:1 ${pair.fg} on ${pair.bg} (${pair.fontSize}px ${pair.kind}` +
  `${pair.disabled ? ', disabled' : ''}) ${pair.selector} "${pair.sample}"`;

for (const viewport of VIEWPORTS) {
  test.describe(`text at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const where of PAGES) {
      test(`${where.name}: no text casts a shadow`, async ({ page, browserName }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        await open(page, where.path);
        const found = await page.evaluate(() => {
          const out: string[] = [];
          const name = (el: Element) =>
            `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
          const elements = new Set<Element>([
            document.body,
            ...document.querySelectorAll('h1, h2, h3, h4, h5, h6'),
          ]);
          // Every element that holds a piece of text of its own.
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if ((node.nodeValue ?? '').trim() && node.parentElement)
              elements.add(node.parentElement);
          }
          for (const el of elements) {
            for (const pseudo of [null, '::before', '::after'] as const) {
              const shadow = getComputedStyle(el, pseudo).textShadow;
              if (shadow !== 'none') out.push(`${name(el)}${pseudo ?? ''}: ${shadow}`);
            }
          }
          return { checked: elements.size, out };
        });
        expect(found.checked, 'elements with text measured').toBeGreaterThan(10);
        expect(found.out, 'text with a shadow').toEqual([]);
      });

      test(`${where.name}: text is at least 4.5:1, on the raised surface too`, async ({
        page,
        browserName,
      }) => {
        test.skip(
          browserName !== 'chromium',
          "Chromium only: Playwright's Windows WebKit crashes inside axe's color-contrast rule.",
        );
        await open(page, where.path);
        await installAudit(page);

        const pairs = await probeContrast(page);
        expect(pairs.length, 'pieces of text measured').toBeGreaterThan(5);
        expect(
          pairs.filter((pair) => !pair.disabled && pair.ratio < TEXT_MIN).map(line),
          'text under 4.5:1',
        ).toEqual([]);

        const axe = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
        expect(
          axe.violations.flatMap((violation) =>
            violation.nodes.map((node) => node.target.join(' ')),
          ),
          'axe color-contrast violations',
        ).toEqual([]);

        const undecided: string[] = [];
        for (const node of axe.incomplete.flatMap((result) => result.nodes)) {
          const target = node.target.join(' ');
          const own = await probeContrastOf(page, target);
          if (!own) undecided.push(`not measured: ${target}`);
          else if (own.ratio < (own.disabled ? DISABLED_MIN : TEXT_MIN)) undecided.push(line(own));
        }
        expect(undecided, 'nodes axe left incomplete that are not 4.5:1 when computed').toEqual([]);
      });

      test(`${where.name}: nothing animates a shadow with reduced motion, and no glow ever pulses`, async ({
        page,
        browserName,
      }) => {
        test.skip(browserName === 'webkit' && viewport.width >= 768, WEBKIT_IS_A_PHONE);
        const moving = () =>
          page.evaluate(() =>
            document
              .getAnimations()
              .filter((animation) => animation.playState === 'running')
              .filter((animation) => {
                const effect = animation.effect as KeyframeEffect | null;
                return (effect?.getKeyframes() ?? []).some((frame) => 'boxShadow' in frame);
              })
              .map((animation) => {
                const target = (animation.effect as KeyframeEffect).target;
                return {
                  target: target?.tagName.toLowerCase() ?? '',
                  // A button of this batch, or a lifted box: those never pulse.
                  ours: Boolean(
                    target?.closest('.glow-accent') || target?.hasAttribute('data-elev'),
                  ),
                };
              }),
          );

        await open(page, where.path);
        expect(
          (await moving()).filter((animation) => animation.ours),
          'a button glow or an elevation that is animated',
        ).toEqual([]);

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
        await expect(page.locator('h1').first()).toBeVisible();
        expect(await moving(), 'shadows animated under reduced motion').toEqual([]);
      });
    }
  });
}
