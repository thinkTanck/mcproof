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

/**
 * Scroll `box` (and only `box`) so `line` is in view. Smooth unless motion is
 * reduced. Returns where it leaves the box: the scrollTop it asked for, or the
 * one it was already going to when the line was already in view.
 */
export function followStepInside(box: HTMLElement, line: Element, smooth: boolean): number {
  if (typeof box.scrollTo !== 'function') return box.scrollTop;
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
  if (next === null) return from;
  requested.set(box, { top: next, at: now });
  box.scrollTo({ top: next, behavior: smooth ? 'smooth' : 'auto' });
  return next;
}

/**
 * FOLLOW ONLY FROM THE LIVE EDGE (owner ruling REPLAY SCROLL, 2026-10-20). The
 * terminal follows the playhead while the viewer is at its bottom, which is
 * where the current line is in view, or the box's own end. A pixel or two is
 * rounding.
 */
export function atLiveEdge(
  view: { scrollTop: number; clientHeight: number; scrollHeight: number },
  line: LineSpan,
): boolean {
  const bottom = view.scrollTop + view.clientHeight;
  return line.bottom <= bottom + 2 || bottom >= view.scrollHeight - 2;
}

/**
 * WHEN TO FOLLOW (owner rulings FLAKE FIX FIRST and FLAKE FIX 2, 2026-10-21,
 * fixing #250).
 *
 *  - Any viewer input on the terminal (a wheel, a touch, a press on its
 *    scrollbar, a scroll key) stops the follow at once, even while a smooth
 *    follow is on its way.
 *  - An UPWARD key or wheel marks the viewer as moved away at once, before any
 *    scroll lands: an engine may apply it late (desktop WebKit, about 400 ms),
 *    and letting go of the key must not read as never having left. Any scroll
 *    the follow did not make that moves away from the bottom marks it too.
 *    Only a downward input, or a scroll down that reaches the bottom, clears it.
 *  - The follow resumes only when the viewer has not moved away and the box
 *    has been still at the bottom for `RESUME_AFTER_MS` after their last input
 *    (`mayResume`).
 *
 * A pixel either way is rounding.
 */
export type FollowState = { following: boolean; movedAway: boolean };
export type FollowEvent =
  | { kind: 'input'; toward: 'up' | 'down' | 'none' }
  | { kind: 'scroll'; from: number; to: number; atBottom: boolean; ours: boolean };

/** How long the box must be still at the bottom, after the last input, before the follow resumes. */
export const RESUME_AFTER_MS = 800;

export function nextFollow(state: FollowState, event: FollowEvent): FollowState {
  if (event.kind === 'input') {
    const movedAway =
      event.toward === 'up' ? true : event.toward === 'down' ? false : state.movedAway;
    return { following: false, movedAway };
  }
  if (!event.ours && event.to < event.from - 1) return { following: false, movedAway: true };
  if (event.to > event.from + 1 && event.atBottom) return { ...state, movedAway: false };
  return state;
}

/** May the follow resume now? Only still at the bottom, long enough after the last input and scroll. */
export function mayResume(
  state: FollowState,
  now: { atBottom: boolean; sinceInput: number; sinceScroll: number },
): boolean {
  return (
    !state.following &&
    !state.movedAway &&
    now.atBottom &&
    now.sinceInput >= RESUME_AFTER_MS &&
    now.sinceScroll >= RESUME_AFTER_MS
  );
}

/**
 * Is the box at the bottom? Where the follow last held it (`followAt`), or
 * lower, or at the box's own end. Not "the current line is in view": a
 * viewer who scrolled up a little can still see it, and has still left.
 */
export function atFollowBottom(
  view: { scrollTop: number; clientHeight: number; scrollHeight: number },
  followAt: number,
): boolean {
  return (
    view.scrollTop >= followAt - 2 || view.scrollTop + view.clientHeight >= view.scrollHeight - 2
  );
}

/**
 * Is a smooth follow this module asked for still on its way to `to`'s side?
 * A scroll it made moves toward its target; anything else is the viewer's.
 */
export function isOurScroll(box: HTMLElement, from: number, to: number): boolean {
  const last = requested.get(box);
  if (!last || performance.now() - last.at >= IN_FLIGHT_MS) return false;
  if (to === last.top) return true;
  return Math.sign(to - from) === Math.sign(last.top - from);
}

/** Stop a smooth follow where it is: the viewer has taken the terminal. */
export function cancelFollow(box: HTMLElement): void {
  if (!requested.has(box)) return;
  requested.delete(box);
  if (typeof box.scrollTo === 'function') box.scrollTo({ top: box.scrollTop, behavior: 'instant' });
}

/** The nearest ancestor of `el` that scrolls vertically, or null when none does. */
export function scrollingBox(el: Element): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) return null;
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}
