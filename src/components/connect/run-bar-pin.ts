'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * WHERE THE RUN BAR IS HELD ON A PHONE.
 *
 * From 768px up the run bar leads the run column and is pinned under the
 * header. That pin only takes hold once the page has been scrolled past the
 * bar's place in the flow, and on a phone that place is three to six screens
 * down a page that opens at its top: reported from a real iPhone, the bar was
 * not on screen when the page opened.
 *
 * So on a phone held upright the bar is the LAST thing on the Connect page, and
 * it is held at the bottom of the screen until the reader reaches it. The
 * screen draws an empty slot at the end of its column (`position: sticky;
 * bottom: 0`), and the console draws the bar into that slot instead of into the
 * run column. At the end of the page the bar simply sits where it is in the
 * flow, so it can never cover the last line, and no spacer has to be kept in
 * step with its height.
 *
 * Why a slot and not `position: fixed`: the run column eases in on a transform,
 * and the page column is a query container; either can re-anchor a fixed box to
 * itself, and which engines do so has changed between versions. Sticky inside
 * the page's own column depends on neither.
 *
 * Under 500px of height the bar is not held at all, top or bottom (a phone on
 * its side has no room to give it), so the query stops there.
 *
 * This is the same query the `phone-tall:` CSS variant in `src/app/globals.css`
 * is built on, and a unit test holds the two equal.
 */
export const RUN_BAR_PIN_QUERY = '(max-width: 767.98px) and (min-height: 500px)';

/**
 * How much of the bottom of the window the pinned bar covers, written to the
 * document root while it is pinned. The document's scroll padding reads it
 * (globals.css), so a control brought into view by the keyboard stops above the
 * bar and not under it (WCAG 2.2, 2.4.11).
 */
export const RUN_BAR_CLEAR_VAR = '--run-bar-clear';

/** The gap kept between a focused control and the bar, as the header keeps one. */
const CLEAR_GAP = 8;

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mq = window.matchMedia(RUN_BAR_PIN_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(RUN_BAR_PIN_QUERY).matches;
}

/** The server cannot see the screen. It never draws a bar either: a run starts in the browser. */
function getServerSnapshot(): boolean {
  return false;
}

/** Whether this screen holds the run bar at the bottom. */
export function useRunBarPinned(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Measure the pinned bar and tell the document how much to clear.
 *
 * Returns a ref for the bar. While `active`, its height (and a small gap) is
 * written to `--run-bar-clear` and kept current by a ResizeObserver: the bar
 * grows with the text size and changes with the run's state. The property is
 * removed when the bar is no longer pinned or is gone. It only ever feeds
 * scroll padding, so writing it moves nothing on the page.
 */
export function useRunBarClearance(active: boolean): (node: HTMLElement | null) => void {
  const [node, setNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!active || node === null || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const write = () => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      root.style.setProperty(RUN_BAR_CLEAR_VAR, `${height + CLEAR_GAP}px`);
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(node, { box: 'border-box' });
    return () => {
      observer.disconnect();
      root.style.removeProperty(RUN_BAR_CLEAR_VAR);
    };
  }, [active, node]);

  return setNode;
}
