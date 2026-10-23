import type { Page } from '@playwright/test';

/**
 * IN-PAGE PROBES FOR SMALL-TEXT LINE SPACING (WCAG 1.4.12).
 *
 * Everything here measures the laid-out page, never a class name: which text
 * actually wrapped at this width, what line-height the browser computed for it,
 * and what happens to the layout when a reader applies their own text spacing.
 *
 * No exact pixel sizes come out of this file. It reports ratios, line counts
 * and how far one box runs past another, and the specs compare those with
 * floors and small tolerances, because Linux CI and an iPhone do not share a
 * font rasteriser with a Windows desk.
 */

/** One element whose own text is under 16px and sits in a block that wrapped. */
export interface SmallTextBlock {
  /** A short path to the element: tag, test id and the first classes. */
  selector: string;
  /** The start of the text, so a failure reads as a sentence and not a path. */
  sample: string;
  fontSize: number;
  /** Computed line-height in px, or null when the browser reports `normal`. */
  lineHeight: number | null;
  /** lineHeight / fontSize, or null when the line-height is `normal`. */
  ratio: number | null;
  /** How many lines the block it belongs to wrapped onto. */
  lines: number;
}

/** A box that lost content, or two text blocks drawn over each other. */
export interface SpacingDefect {
  kind: 'clipped' | 'spilled' | 'unreachable-scroller' | 'overlap';
  selector: string;
  sample: string;
  /** How far past the box, or into the neighbour, in CSS px (rounded). */
  by: number;
}

/**
 * The text-spacing override from WCAG 1.4.12, as a reader's bookmarklet or user
 * stylesheet would apply it: line-height 1.5, paragraph spacing twice the font
 * size, letter-spacing 0.12em, word-spacing 0.16em, all forced.
 */
export const TEXT_SPACING_OVERRIDE = `
  * {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p {
    margin-bottom: 2em !important;
  }
`;

/**
 * Every element with text under 16px that belongs to a block which wrapped onto
 * more than one line at the current width.
 *
 * A "block" is the nearest ancestor that is not `display: inline` or `contents`:
 * the box whose lines the text is laid out in. A row of chips that wraps is not
 * a wrapped block (each chip is its own box and holds one line), and neither is
 * a button whose label fits. A button whose label does wrap IS one: two crowded
 * lines are crowded whatever the element is called.
 *
 * Skipped on purpose: SVG text (positioned by coordinates, not line boxes),
 * anything not rendered, and visually hidden text (a one-pixel clipped box that
 * no sighted reader sees).
 */
export function probeWrappingSmallText(page: Page): Promise<SmallTextBlock[]> {
  return page.evaluate(() => {
    const passThrough = (el: Element) => {
      const display = getComputedStyle(el).display;
      return display === 'inline' || display === 'contents';
    };
    const blockOf = (el: Element): Element => {
      let current: Element = el;
      while (current.parentElement && passThrough(current)) current = current.parentElement;
      return current;
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
    const describe = (el: Element): string => {
      const part = (node: Element) => {
        const id = node.getAttribute('data-testid');
        const classes = [...node.classList].slice(0, 4).join('.');
        return `${node.tagName.toLowerCase()}${id ? `[data-testid=${id}]` : ''}${classes ? `.${classes}` : ''}`;
      };
      const parent = el.parentElement;
      return parent && parent !== document.body ? `${part(parent)} > ${part(el)}` : part(el);
    };

    type Line = { centre: number; height: number };
    const blocks = new Map<Element, { lines: Line[]; owners: Set<Element> }>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue || node.nodeValue.trim() === '') continue;
      const owner = node.parentElement;
      if (!owner) continue;
      if (owner.closest('svg, script, style, noscript, template')) continue;
      if (!owner.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      if (visuallyHidden(owner)) continue;

      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
      if (rects.length === 0) continue;

      const block = blockOf(owner);
      const entry = blocks.get(block) ?? { lines: [], owners: new Set<Element>() };
      entry.owners.add(owner);
      for (const rect of rects) {
        entry.lines.push({ centre: rect.top + rect.height / 2, height: rect.height });
      }
      blocks.set(block, entry);
    }

    const found: SmallTextBlock[] = [];
    for (const [block, entry] of blocks) {
      // Count lines by where each fragment's centre sits. Fragments on one line
      // share a centre to within a fraction of their height; the next line's
      // centre is a whole line pitch further down, however tight the pitch.
      const sorted = entry.lines.sort((a, b) => a.centre - b.centre);
      let lines = 0;
      let last = Number.NEGATIVE_INFINITY;
      for (const line of sorted) {
        if (line.centre - last > line.height * 0.5) {
          lines += 1;
          last = line.centre;
        }
      }
      if (lines < 2) continue;

      for (const el of new Set([block, ...entry.owners])) {
        const style = getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize);
        if (!(fontSize < 16)) continue;
        const lineHeight = style.lineHeight === 'normal' ? null : parseFloat(style.lineHeight);
        found.push({
          selector: describe(el),
          sample: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70),
          fontSize,
          lineHeight,
          ratio: lineHeight === null ? null : lineHeight / fontSize,
          lines,
        });
      }
    }
    return found;
  });
}

/**
 * What is wrong with the page's text right now, measured on the INK: the line
 * fragments of the text itself, as the browser laid them out.
 *
 * Every fragment is walked up through the boxes it sits in:
 *
 *  - clipped: the fragment runs past a box that hides its overflow, so part of
 *    the text is not drawn (a cut-off word, an ellipsis).
 *  - unreachable-scroller: it runs past a scroll box that a keyboard cannot
 *    reach. A scroll box that IS reachable is how the copy-out boxes are meant
 *    to work, and is not a defect.
 *  - spilled: it runs out of the bottom of a box that does not hide overflow,
 *    over whatever is drawn below (a fixed height the text outgrew).
 *  - overlap: fragments of two different text blocks are drawn over each other.
 *    Only blocks in the same layer are compared, because a sticky bar is meant
 *    to pass over what scrolls under it.
 *
 * Box model sizes (`scrollWidth` against `clientWidth`) are deliberately not
 * used: they count line-box leading and decorative overhang, and engines
 * disagree about nested scroll boxes. A reader loses ink, not leading.
 *
 * `tolerance` is in CSS px and absorbs sub-pixel rounding and the little a
 * font's ascent and descent reach past a tight box.
 *
 * It reports what is there, not what changed: run it with
 * {@link TEXT_SPACING_OVERRIDE} applied and the list is everything a reader who
 * sets their own spacing would lose, whether or not the page already lost it.
 */
export function probeSpacingDefects(page: Page, tolerance = 3): Promise<SpacingDefect[]> {
  return page.evaluate((tol) => {
    type Box = { left: number; right: number; top: number; bottom: number };

    const styles = new Map<Element, CSSStyleDeclaration>();
    const styleOf = (el: Element) => {
      let style = styles.get(el);
      if (!style) styles.set(el, (style = getComputedStyle(el)));
      return style;
    };
    const frames = new Map<Element, DOMRect>();
    const frameOf = (el: Element) => {
      let frame = frames.get(el);
      if (!frame) frames.set(el, (frame = el.getBoundingClientRect()));
      return frame;
    };
    const hidden = new Map<Element, boolean>();
    const visuallyHidden = (el: Element): boolean => {
      if (el === document.body) return false;
      const known = hidden.get(el);
      if (known !== undefined) return known;
      const style = styleOf(el);
      const frame = frameOf(el);
      const result =
        style.clipPath === 'inset(50%)' ||
        style.clip === 'rect(0px, 0px, 0px, 0px)' ||
        (style.overflowX !== 'visible' && (frame.width <= 2 || frame.height <= 2)) ||
        (el.parentElement !== null && visuallyHidden(el.parentElement));
      hidden.set(el, result);
      return result;
    };
    const describe = (el: Element): string => {
      const part = (node: Element) => {
        const id = node.getAttribute('data-testid');
        const classes = [...node.classList].slice(0, 4).join('.');
        return `${node.tagName.toLowerCase()}${id ? `[data-testid=${id}]` : ''}${classes ? `.${classes}` : ''}`;
      };
      const parent = el.parentElement;
      return parent && parent !== document.body ? `${part(parent)} > ${part(el)}` : part(el);
    };
    const sampleOf = (el: Element) =>
      (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70);
    const hides = (value: string) => value === 'hidden' || value === 'clip';
    const reachable = (el: Element) =>
      (el as HTMLElement).tabIndex >= 0 ||
      el.querySelector(
        'a[href], button, input, select, textarea, summary:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
      ) !== null;
    const inline = (el: Element) => {
      const display = styleOf(el).display;
      return display === 'inline' || display === 'contents';
    };
    const blockOf = (el: Element): Element => {
      let current: Element = el;
      while (current.parentElement && inline(current)) current = current.parentElement;
      return current;
    };
    /** The nearest box that is lifted out of the page's own flow, if any. */
    const layerOf = (el: Element): Element | null => {
      for (let cur: Element | null = el; cur && cur !== document.body; cur = cur.parentElement) {
        const position = styleOf(cur).position;
        if (position === 'fixed' || position === 'sticky' || position === 'absolute') return cur;
      }
      return null;
    };

    const worst = new Map<string, SpacingDefect>();
    const note = (kind: SpacingDefect['kind'], el: Element, by: number, sample = sampleOf(el)) => {
      const selector = describe(el);
      const key = `${kind}|${selector}|${sample}`;
      const rounded = Math.round(by);
      const previous = worst.get(key);
      if (!previous || previous.by < rounded)
        worst.set(key, { kind, selector, sample, by: rounded });
    };

    /**
     * Walk one fragment up through its boxes, noting what each one costs it,
     * and return the part of it that is actually on show (or null if none is).
     */
    const follow = (rect: DOMRect, owner: Element): Box | null => {
      const box: Box = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      // Out-of-flow content is not held by the boxes above it, so nothing above
      // an absolutely positioned box can be said to have been outgrown by it.
      let held = true;
      for (let cur: Element | null = owner; cur && cur !== document.body; cur = cur.parentElement) {
        const style = styleOf(cur);
        if (!inline(cur)) {
          const frame = frameOf(cur);
          const pastX = Math.max(box.right - frame.right, frame.left - box.left);
          const pastY = Math.max(box.bottom - frame.bottom, frame.top - box.top);

          if (style.overflowX !== 'visible') {
            if (pastX > tol) {
              if (hides(style.overflowX)) note('clipped', cur, pastX, sampleOf(owner));
              else if (!reachable(cur)) note('unreachable-scroller', cur, pastX);
            }
            box.left = Math.max(box.left, frame.left);
            box.right = Math.min(box.right, frame.right);
          }
          if (style.overflowY !== 'visible') {
            if (pastY > tol) {
              if (hides(style.overflowY)) note('clipped', cur, pastY, sampleOf(owner));
              else if (!reachable(cur)) note('unreachable-scroller', cur, pastY);
            }
            box.top = Math.max(box.top, frame.top);
            box.bottom = Math.min(box.bottom, frame.bottom);
          } else if (held && box.bottom - frame.bottom > tol) {
            note('spilled', cur, box.bottom - frame.bottom);
          }
          if (box.right - box.left <= 1 || box.bottom - box.top <= 1) return null;
        }
        if (style.position === 'absolute' || style.position === 'fixed') held = false;
      }
      return box;
    };

    const blocks = new Map<Element, { layer: Element | null; fragments: Box[]; bounds: Box }>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue || node.nodeValue.trim() === '') continue;
      const owner = node.parentElement;
      if (!owner || owner.closest('svg, script, style, noscript, template')) continue;
      if (!owner.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      if (visuallyHidden(owner)) continue;

      range.selectNodeContents(node);
      const block = blockOf(owner);
      for (const rect of range.getClientRects()) {
        if (rect.width <= 0.5 || rect.height <= 0.5) continue;
        const shown = follow(rect, owner);
        if (!shown) continue;
        let entry = blocks.get(block);
        if (!entry) {
          entry = { layer: layerOf(block), fragments: [], bounds: { ...shown } };
          blocks.set(block, entry);
        }
        entry.fragments.push(shown);
        entry.bounds.left = Math.min(entry.bounds.left, shown.left);
        entry.bounds.right = Math.max(entry.bounds.right, shown.right);
        entry.bounds.top = Math.min(entry.bounds.top, shown.top);
        entry.bounds.bottom = Math.max(entry.bounds.bottom, shown.bottom);
      }
    }

    const shared = (a: Box, b: Box) =>
      Math.min(
        Math.min(a.right, b.right) - Math.max(a.left, b.left),
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
      );
    const list = [...blocks.entries()];
    for (let i = 0; i < list.length; i += 1) {
      const [first, a] = list[i]!;
      for (let j = i + 1; j < list.length; j += 1) {
        const [second, b] = list[j]!;
        if (a.layer !== b.layer || shared(a.bounds, b.bounds) <= tol) continue;
        let most = 0;
        for (const fa of a.fragments) {
          for (const fb of b.fragments) most = Math.max(most, shared(fa, fb));
        }
        if (most > tol) {
          const sample = `${sampleOf(first).slice(0, 32)} || ${sampleOf(second).slice(0, 32)}`;
          note('overlap', first, most, sample);
        }
      }
    }
    return [...worst.values()];
  }, tolerance);
}

/** How far the page itself scrolls sideways, in CSS px. Zero or less is none. */
export function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/**
 * The elements that reach past the right edge of the page, deepest first, and
 * whether each sits in the shared header. It names what a sideways scroll is
 * made of, so a failure says which element to look at.
 */
export function widerThanThePage(page: Page): Promise<{ selector: string; inHeader: boolean }[]> {
  return page.evaluate(() => {
    // In page coordinates, not viewport ones. Once the page can scroll
    // sideways, stepping through the replay can scroll it (WebKit on Linux CI
    // did), and then the element that made the overflow sits inside the
    // viewport and a viewport-relative test finds nothing to name.
    const limit = document.documentElement.clientWidth + 1;
    const past = (el: Element) => el.getBoundingClientRect().right + window.scrollX > limit;
    const found: { selector: string; inHeader: boolean }[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('svg') || !el.checkVisibility()) continue;
      if (!past(el) || [...el.children].some(past)) continue;
      // Held back by a box that hides or scrolls its own overflow: it is cut
      // off there (which the defect probe reports), it does not widen the page.
      let contained = false;
      for (let cur = el.parentElement; cur && cur !== document.body; cur = cur.parentElement) {
        if (getComputedStyle(cur).overflowX !== 'visible' && !past(cur)) contained = true;
      }
      if (contained) continue;
      const classes = [...el.classList].slice(0, 4).join('.');
      found.push({
        selector: `${el.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`,
        inHeader: el.closest('header') === document.querySelector('header'),
      });
    }
    return found;
  });
}
