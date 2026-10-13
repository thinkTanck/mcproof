import type { Page } from '@playwright/test';

/**
 * IN-PAGE PROBES FOR THE UI AUDIT (contrast, the text floor, targets, focus).
 *
 * Everything here measures the page a reader gets: the colour the browser
 * computed for a piece of text and for whatever is painted under it, the size a
 * text node is drawn at, the box of a control, and the outline a control wears
 * while the keyboard is on it. Nothing reads a class name.
 *
 * COLOUR. A computed colour can be `rgb()`, `rgba()`, `color(srgb ...)` or
 * `oklab(...)` (Tailwind's opacity modifiers mix in oklab), so no string is
 * parsed. Each colour is painted on a one-pixel canvas over black and over
 * white and read back: the black reading is the colour already multiplied by
 * its alpha, and the difference between the two readings is the alpha.
 *
 * BACKGROUND. The background under an element is built from the root down:
 * the page colour, then every ancestor's background colour laid over it at its
 * own alpha and opacity. A gradient is not one colour, so each colour named in
 * it is laid over what was there and both the lightest and the darkest result
 * are kept; a contrast is then the WORST of the candidates. That is how text
 * over a gradient or a translucent panel, which axe marks "incomplete", gets a
 * number here.
 *
 * No exact sizes come out of this file except floors (12px text, 2px ring).
 */

export interface ContrastPair {
  selector: string;
  sample: string;
  /** Worst contrast over the background candidates, two decimals. */
  ratio: number;
  fg: string;
  bg: string;
  fontSize: number;
  /** WCAG large text: 24px and up, or 18.66px and up in bold. */
  large: boolean;
  /** Inside a disabled control: exempt under WCAG 1.4.3, listed all the same. */
  disabled: boolean;
  /** `text`, an input's `value`, or its `placeholder`. */
  kind: 'text' | 'value' | 'placeholder';
  /** True when a gradient or an image is part of the background. */
  overGradient: boolean;
}

export interface SmallText {
  selector: string;
  sample: string;
  /** The size the text is drawn at: computed font-size times any SVG scale. */
  rendered: number;
  fontSize: number;
  svg: boolean;
}

export interface SmallTarget {
  selector: string;
  name: string;
  width: number;
  height: number;
  /** A link or button that sits inside a line of text. */
  inline: boolean;
  disabled: boolean;
}

export interface FocusStop {
  selector: string;
  name: string;
  outlineStyle: string;
  outlineWidth: number;
  outlineOffset: number;
  outlineColor: string;
  /** Ring colour against the background it is drawn on, worst candidate. */
  ringContrast: number;
  /** What else changed between unfocused and focused, for the report. */
  changed: string[];
  /** The side and container that cut the ring off, or '' when it is whole. */
  clipped: string;
  /** How far the control's own box resized when it took focus. */
  shift: number;
  /** The corner radius before and after, when focus changed it; '' when not. */
  radius: string;
  /** Visually hidden until focused (a skip link): its box is meant to appear. */
  revealed: boolean;
}

/**
 * Installs `window.__uiAudit` in the page. Call again after every navigation.
 * One function so the helpers are shared by every probe below.
 */
export async function installAudit(page: Page): Promise<void> {
  await page.evaluate(() => {
    type RGB = [number, number, number];
    type Paint = { pm: RGB; a: number };

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const cache = new Map<string, Paint>();

    const paint = (css: string): Paint => {
      const hit = cache.get(css);
      if (hit) return hit;
      const over = (under: string): RGB => {
        ctx.globalAlpha = 1;
        ctx.fillStyle = under;
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
      };
      const black = over('#000');
      const white = over('#fff');
      const a =
        1 - (white[0] - black[0] + (white[1] - black[1]) + (white[2] - black[2])) / (3 * 255);
      const result = { pm: black, a: Math.min(1, Math.max(0, a)) };
      cache.set(css, result);
      return result;
    };

    /** `top` laid over `under`, with a further opacity on `top`. */
    const lay = (top: Paint, opacity: number, under: RGB): RGB => [
      top.pm[0] * opacity + under[0] * (1 - top.a * opacity),
      top.pm[1] * opacity + under[1] * (1 - top.a * opacity),
      top.pm[2] * opacity + under[2] * (1 - top.a * opacity),
    ];

    const luminance = ([r, g, b]: RGB): number => {
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const contrast = (a: RGB, b: RGB): number => {
      const [l1, l2] = [luminance(a), luminance(b)];
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const hex = (c: RGB): string =>
      `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

    const COLOUR = /(?:rgba?|hsla?|color|oklab|oklch|lab|lch|hwb)\([^()]*\)/g;

    /** The chain from the root element down to `el`, both included. */
    const chainTo = (el: Element): Element[] => {
      const chain: Element[] = [];
      for (let cur: Element | null = el; cur; cur = cur.parentElement) chain.unshift(cur);
      return chain;
    };

    /** The product of the opacity of `el` and every ancestor. */
    const opacityOf = (el: Element): number => {
      let o = 1;
      for (let cur: Element | null = el; cur; cur = cur.parentElement) {
        o *= Number(getComputedStyle(cur).opacity);
      }
      return o;
    };

    /**
     * What is painted under `el`'s content, as candidates. `includeSelf` false
     * gives what is painted AROUND the element (where an outside ring sits).
     */
    const backgroundsOf = (
      el: Element,
      includeSelf: boolean,
    ): { candidates: RGB[]; gradient: boolean } => {
      let candidates: RGB[] = [[255, 255, 255]];
      let gradient = false;
      let opacity = 1;
      const chain = chainTo(el);
      if (!includeSelf) chain.pop();
      for (const node of chain) {
        const style = getComputedStyle(node);
        opacity *= Number(style.opacity);
        const colour = paint(style.backgroundColor);
        if (colour.a > 0) candidates = candidates.map((under) => lay(colour, opacity, under));
        const image = style.backgroundImage;
        if (image && image !== 'none') {
          gradient = true;
          const stops = image.match(COLOUR) ?? [];
          const next: RGB[] = [...candidates];
          for (const stop of stops) {
            const p = paint(stop);
            if (p.a === 0) continue;
            for (const under of candidates) next.push(lay(p, opacity, under));
          }
          // Keep the two extremes: the worst case for light text and for dark.
          next.sort((x, y) => luminance(x) - luminance(y));
          candidates = next.length > 1 ? [next[0]!, next[next.length - 1]!] : next;
        }
      }
      return { candidates, gradient };
    };

    /** The worst contrast of a colour (with its own alpha) over the candidates. */
    const worst = (
      colour: string,
      opacity: number,
      candidates: RGB[],
    ): { ratio: number; fg: RGB; bg: RGB } => {
      const p = paint(colour);
      let out = { ratio: Infinity, fg: [0, 0, 0] as RGB, bg: [0, 0, 0] as RGB };
      for (const bg of candidates) {
        const fg = lay(p, opacity, bg);
        const ratio = contrast(fg, bg);
        if (ratio < out.ratio) out = { ratio, fg, bg };
      }
      return out;
    };

    const visuallyHidden = (el: Element): boolean => {
      for (let cur: Element | null = el; cur && cur !== document.body; cur = cur.parentElement) {
        const style = getComputedStyle(cur);
        if (style.clipPath === 'inset(50%)' || style.clip === 'rect(0px, 0px, 0px, 0px)') {
          return true;
        }
        const rect = cur.getBoundingClientRect();
        if (style.overflowX !== 'visible' && (rect.width <= 2 || rect.height <= 2)) return true;
      }
      return false;
    };

    const rendered = (el: Element): boolean =>
      el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) &&
      !visuallyHidden(el) &&
      opacityOf(el) > 0.01;

    const describe = (el: Element): string => {
      const part = (node: Element) => {
        const id = node.getAttribute('data-testid');
        const classes = [...node.classList]
          .filter((c) => !/[[\]:/()]/.test(c))
          .slice(0, 3)
          .join('.');
        return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${id ? `[data-testid=${id}]` : ''}${classes ? `.${classes}` : ''}`;
      };
      const parts: string[] = [part(el)];
      let cur = el.parentElement;
      for (let depth = 0; cur && cur !== document.body && depth < 2; depth += 1) {
        parts.unshift(part(cur));
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    };

    const sampleOf = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 48);

    const nameOf = (el: Element): string =>
      sampleOf(
        el.getAttribute('aria-label') ??
          (el as HTMLInputElement).labels?.[0]?.textContent ??
          el.textContent ??
          '',
      ) || el.tagName.toLowerCase();

    const isDisabled = (el: Element): boolean =>
      el.closest(':disabled, [aria-disabled="true"]') !== null;

    /** Every element that owns a rendered, non-empty text node. */
    const textOwners = (): Map<Element, string> => {
      const owners = new Map<Element, string>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.nodeValue || node.nodeValue.trim() === '') continue;
        const owner = node.parentElement;
        if (!owner || owner.closest('script, style, noscript, template')) continue;
        if (!rendered(owner)) continue;
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
        if (rects.length === 0) continue;
        owners.set(owner, (owners.get(owner) ?? '') + node.nodeValue);
      }
      return owners;
    };

    const pairFor = (
      el: Element,
      colour: string,
      text: string,
      kind: 'text' | 'value' | 'placeholder',
    ) => {
      const style = getComputedStyle(el);
      const { candidates, gradient } = backgroundsOf(el, true);
      const w = worst(colour, opacityOf(el), candidates);
      const fontSize = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      return {
        selector: describe(el),
        sample: sampleOf(text),
        ratio: Math.floor(w.ratio * 100) / 100,
        fg: hex(w.fg),
        bg: hex(w.bg),
        fontSize,
        large: fontSize >= 24 || (bold && fontSize >= 18.66),
        disabled: isDisabled(el),
        kind,
        overGradient: gradient,
      };
    };

    const contrastPairs = () => {
      const pairs: ReturnType<typeof pairFor>[] = [];
      for (const [el, text] of textOwners()) {
        pairs.push(pairFor(el, getComputedStyle(el).color, text, 'text'));
      }
      for (const input of document.querySelectorAll<HTMLInputElement>('input, textarea, select')) {
        if (!rendered(input) || input.type === 'hidden') continue;
        if (input.value)
          pairs.push(pairFor(input, getComputedStyle(input).color, input.value, 'value'));
        else if (input.placeholder) {
          pairs.push(
            pairFor(
              input,
              getComputedStyle(input, '::placeholder').color,
              input.placeholder,
              'placeholder',
            ),
          );
        }
      }
      return pairs;
    };

    /** The contrast of one element, by selector: for what axe leaves undecided. */
    const contrastOf = (selector: string) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      return pairFor(el, getComputedStyle(el).color, el.textContent ?? '', 'text');
    };

    const smallText = (floor: number) => {
      const out: {
        selector: string;
        sample: string;
        rendered: number;
        fontSize: number;
        svg: boolean;
      }[] = [];
      const push = (el: Element, text: string) => {
        const fontSize = parseFloat(getComputedStyle(el).fontSize);
        let scale = 1;
        const svg = el instanceof SVGElement;
        if (svg && 'getScreenCTM' in el) {
          const m = (el as SVGGraphicsElement).getScreenCTM();
          if (m) scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
        }
        const drawn = Math.round(fontSize * scale * 100) / 100;
        if (drawn < floor - 0.01) {
          out.push({
            selector: describe(el),
            sample: sampleOf(text),
            rendered: drawn,
            fontSize,
            svg,
          });
        }
      };
      for (const [el, text] of textOwners()) push(el, text);
      for (const input of document.querySelectorAll<HTMLInputElement>('input, textarea, select')) {
        if (!rendered(input) || input.type === 'hidden') continue;
        push(input, input.value || input.placeholder || input.type);
      }
      return out;
    };

    const INTERACTIVE =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role="button"], [role="tab"], [role="radio"], [role="checkbox"], [role="switch"], [role="slider"], [role="link"], [role="menuitem"]';

    const smallTargets = (min: number) => {
      const out: {
        selector: string;
        name: string;
        width: number;
        height: number;
        inline: boolean;
        disabled: boolean;
      }[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(INTERACTIVE)) {
        if (!el.checkVisibility({ visibilityProperty: true })) continue;
        // A visually hidden input is operated through its label.
        let box: Element = el;
        if (visuallyHidden(el)) {
          const label = (el as HTMLInputElement).labels?.[0];
          if (!label || visuallyHidden(label)) continue;
          box = label;
        }
        const rect = box.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.width >= min - 0.05 && rect.height >= min - 0.05) continue;
        const inline =
          getComputedStyle(el).display === 'inline' &&
          (el.parentElement?.textContent ?? '').trim().length >
            (el.textContent ?? '').trim().length;
        out.push({
          selector: describe(el),
          name: nameOf(el),
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          inline,
          disabled: isDisabled(el),
        });
      }
      return out;
    };

    // ---- focus -----------------------------------------------------------

    const FOCUS_PROPS = [
      'outlineStyle',
      'outlineWidth',
      'outlineColor',
      'outlineOffset',
      'boxShadow',
      'borderTopColor',
      'borderTopWidth',
      'backgroundColor',
      'color',
      'textDecorationLine',
      'borderTopLeftRadius',
    ] as const;
    type Snapshot = Record<(typeof FOCUS_PROPS)[number], string> & { w: number; h: number };
    const baseline = new WeakMap<Element, Snapshot>();
    const snapshot = (el: Element): Snapshot => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const snap = { w: rect.width, h: rect.height } as Snapshot;
      for (const prop of FOCUS_PROPS) snap[prop] = style[prop];
      return snap;
    };
    const seen = new WeakSet<Element>();

    /** Record how every candidate looks before the keyboard reaches it. */
    const focusBaseline = () => {
      for (const el of document.querySelectorAll(`${INTERACTIVE}, [tabindex], details, [role]`)) {
        if (!baseline.has(el)) baseline.set(el, snapshot(el));
      }
    };

    /** Measure the control the keyboard is on now. `null` when it is the page. */
    const focusStop = async () => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      if (seen.has(el)) return 'seen' as const;
      seen.add(el);
      // `transition-colors` also transitions the outline colour: let it land.
      await Promise.all(
        el
          .getAnimations()
          .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
          .map((a) => a.finished.catch(() => undefined)),
      );
      const now = snapshot(el);
      const before = baseline.get(el);
      const width = now.outlineStyle === 'none' ? 0 : parseFloat(now.outlineWidth);
      const offset = parseFloat(now.outlineOffset) || 0;
      // An outside ring is drawn on what surrounds the control; an inset one on
      // the control's own background.
      const { candidates } = backgroundsOf(el, offset < 0);
      const ring = width > 0 ? worst(now.outlineColor, opacityOf(el), candidates) : null;

      const changed: string[] = [];
      if (before) {
        for (const prop of FOCUS_PROPS) {
          if (before[prop] !== now[prop]) changed.push(`${prop}: ${before[prop]} -> ${now[prop]}`);
        }
      } else changed.push('(no unfocused reading: the control appeared after the page loaded)');

      // Is the ring cut off by a box that clips, or by the edge of the screen?
      let clipped = '';
      const rect = el.getBoundingClientRect();
      // How far past the control's own box the ring reaches: nothing, for a
      // ring drawn inside it.
      const reach = Math.max(0, offset + width);
      const ringBox = {
        left: rect.left - reach,
        right: rect.right + reach,
        top: rect.top - reach,
        bottom: rect.bottom + reach,
      };
      for (let cur = el.parentElement; cur && !clipped; cur = cur.parentElement) {
        const style = getComputedStyle(cur);
        const clipsX = style.overflowX !== 'visible';
        const clipsY = style.overflowY !== 'visible';
        if (!clipsX && !clipsY) continue;
        const box = cur.getBoundingClientRect();
        const inner = {
          left: box.left + cur.clientLeft,
          top: box.top + cur.clientTop,
          right: box.left + cur.clientLeft + cur.clientWidth,
          bottom: box.top + cur.clientTop + cur.clientHeight,
        };
        const sides: string[] = [];
        if (clipsX && ringBox.left < inner.left - 0.5 && rect.left >= inner.left - 0.5)
          sides.push('left');
        if (clipsX && ringBox.right > inner.right + 0.5 && rect.right <= inner.right + 0.5)
          sides.push('right');
        if (clipsY && ringBox.top < inner.top - 0.5 && rect.top >= inner.top - 0.5)
          sides.push('top');
        if (clipsY && ringBox.bottom > inner.bottom + 0.5 && rect.bottom <= inner.bottom + 0.5)
          sides.push('bottom');
        if (sides.length > 0) clipped = `${sides.join('+')} by ${describe(cur)}`;
      }
      if (!clipped) {
        const sides: string[] = [];
        if (ringBox.left < -0.5 && rect.left >= -0.5) sides.push('left');
        if (
          ringBox.right > document.documentElement.clientWidth + 0.5 &&
          rect.right <= document.documentElement.clientWidth + 0.5
        )
          sides.push('right');
        if (sides.length > 0) clipped = `${sides.join('+')} by the screen edge`;
      }

      return {
        selector: describe(el),
        name: nameOf(el),
        outlineStyle: now.outlineStyle,
        outlineWidth: width,
        outlineOffset: offset,
        outlineColor: now.outlineColor,
        ringContrast: ring ? Math.floor(ring.ratio * 100) / 100 : 0,
        changed,
        clipped,
        shift: before
          ? Math.round(Math.max(Math.abs(before.w - now.w), Math.abs(before.h - now.h)) * 10) / 10
          : 0,
        radius:
          before && before.borderTopLeftRadius !== now.borderTopLeftRadius
            ? `${before.borderTopLeftRadius} -> ${now.borderTopLeftRadius}`
            : '',
        revealed: before ? before.w <= 2 || before.h <= 2 : false,
      };
    };

    /**
     * Every control Tab would stop on, in document order. For an engine whose
     * Tab key leaves links out: `focusAt` puts the keyboard on each in turn.
     */
    let tabbable: HTMLElement[] = [];
    const tabbables = (): number => {
      tabbable = [...document.querySelectorAll<HTMLElement>(INTERACTIVE)].filter(
        (el) =>
          el.tabIndex >= 0 &&
          !el.matches(':disabled') &&
          el.closest('[inert]') === null &&
          el.checkVisibility({ visibilityProperty: true }),
      );
      return tabbable.length;
    };
    const focusAt = (index: number) => {
      tabbable[index]?.focus();
      return focusStop();
    };

    (window as unknown as { __uiAudit: unknown }).__uiAudit = {
      tabbables,
      focusAt,
      contrastPairs,
      contrastOf,
      smallText,
      smallTargets,
      focusBaseline,
      focusStop,
    };
  });
}

interface AuditApi {
  contrastPairs(): ContrastPair[];
  contrastOf(selector: string): ContrastPair | null;
  smallText(floor: number): SmallText[];
  smallTargets(min: number): SmallTarget[];
  focusBaseline(): void;
  focusStop(): Promise<FocusStop | 'seen' | null>;
  tabbables(): number;
  focusAt(index: number): Promise<FocusStop | 'seen' | null>;
}
type AuditWindow = { __uiAudit: AuditApi };

/** Every rendered text and its background, with the worst contrast between them. */
export function probeContrast(page: Page): Promise<ContrastPair[]> {
  return page.evaluate(() => (window as unknown as AuditWindow).__uiAudit.contrastPairs());
}

/** The same computation for one element, by selector. */
export function probeContrastOf(page: Page, selector: string): Promise<ContrastPair | null> {
  return page.evaluate((s) => (window as unknown as AuditWindow).__uiAudit.contrastOf(s), selector);
}

/** Rendered text drawn smaller than `floor` CSS px. */
export function probeSmallText(page: Page, floor = 12): Promise<SmallText[]> {
  return page.evaluate((f) => (window as unknown as AuditWindow).__uiAudit.smallText(f), floor);
}

/** Interactive controls whose box is under `min` by `min` CSS px. */
export function probeSmallTargets(page: Page, min = 44): Promise<SmallTarget[]> {
  return page.evaluate((m) => (window as unknown as AuditWindow).__uiAudit.smallTargets(m), min);
}

/**
 * Put the keyboard on every tab stop of the page, from its top, and measure
 * each one once.
 *
 * `walk: 'tab'` presses Tab for real and stops when the keyboard comes back
 * round to a control it has already been on. That is the honest walk, and it is
 * what Chromium gets.
 *
 * `walk: 'script'` is for WebKit, whose Tab key leaves links out of the order
 * (and Playwright's build ignores Option+Tab). One real Tab is pressed, so the
 * page is in keyboard mode and `:focus-visible` applies, and then every
 * tabbable control is focused in document order.
 */
export async function probeFocusStops(
  page: Page,
  { walk = 'tab', max = 200 }: { walk?: 'tab' | 'script'; max?: number } = {},
): Promise<FocusStop[]> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement | null)?.blur?.();
    (window as unknown as AuditWindow).__uiAudit.focusBaseline();
  });
  const stops: FocusStop[] = [];

  if (walk === 'script') {
    await page.keyboard.press('Tab');
    const count = await page.evaluate(() =>
      (window as unknown as AuditWindow).__uiAudit.tabbables(),
    );
    for (let i = 0; i < Math.min(count, max); i += 1) {
      const stop = await page.evaluate(
        (index) => (window as unknown as AuditWindow).__uiAudit.focusAt(index),
        i,
      );
      if (stop && stop !== 'seen') stops.push(stop);
    }
    return stops;
  }

  let offPage = 0;
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() =>
      (window as unknown as AuditWindow).__uiAudit.focusStop(),
    );
    if (stop === 'seen') break;
    if (stop === null) {
      // The keyboard left the page for the browser's own chrome, once per lap.
      offPage += 1;
      if (offPage > 1) break;
      continue;
    }
    stops.push(stop);
  }
  return stops;
}
