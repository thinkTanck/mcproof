/**
 * FOLLOW THE CURRENT STEP INSIDE THE TERMINAL, NEVER THE PAGE (Part D).
 *
 * On a phone the terminal is a capped box that scrolls inside itself. When the
 * playhead moves, the box scrolls the least it can to show the whole current
 * line, the way a console keeps its newest line at the bottom: down when the
 * line is below the visible part, up when it is above (scrubbing back), and not
 * at all when it is in view. `scrollIntoView` is not used because it scrolls
 * every scrolling ancestor, the page included.
 */

/** The box's scroll state. */
export type ScrollView = {
  scrollTop: number;
  clientHeight: number;
  paddingTop: number;
  paddingBottom: number;
};

/** A line's extent in the box's scroll coordinates (0 is the top of its padding box). */
export type LineSpan = { top: number; bottom: number };

/** The scrollTop that shows the whole line, or null when it is already in view. */
export function nextScrollTop(view: ScrollView, line: LineSpan): number | null {
  const from = line.top - view.paddingTop;
  const to = line.bottom + view.paddingBottom;
  // Taller than the box: show where it starts.
  if (to - from > view.clientHeight) return Math.max(0, from);
  if (from < view.scrollTop) return Math.max(0, from);
  if (to > view.scrollTop + view.clientHeight) return to - view.clientHeight;
  return null;
}

/**
 * How long a smooth scroll this module asked for may still be on its way. Within
 * it, the box is judged from where it is GOING, not where it is: scrub to the end
 * and straight back, and the first line is still in view at the old scroll
 * position, so judging from there left the first scroll to carry on to the end.
 */
const IN_FLIGHT_MS = 1000;
const requested = new WeakMap<HTMLElement, { top: number; at: number }>();

/** Scroll `box` (and only `box`) so `line` is in view. Smooth unless motion is reduced. */
export function followStepInside(box: HTMLElement, line: Element, smooth: boolean): void {
  if (typeof box.scrollTo !== 'function') return;
  const now = performance.now();
  const last = requested.get(box);
  const from = last && now - last.at < IN_FLIGHT_MS ? last.top : box.scrollTop;
  const b = box.getBoundingClientRect();
  const l = line.getBoundingClientRect();
  const style = getComputedStyle(box);
  const top = l.top - b.top - box.clientTop + box.scrollTop;
  const next = nextScrollTop(
    {
      scrollTop: from,
      clientHeight: box.clientHeight,
      paddingTop: parseFloat(style.paddingTop) || 0,
      paddingBottom: parseFloat(style.paddingBottom) || 0,
    },
    { top, bottom: top + l.height },
  );
  if (next === null) return;
  requested.set(box, { top: next, at: now });
  box.scrollTo({ top: next, behavior: smooth ? 'smooth' : 'auto' });
}
