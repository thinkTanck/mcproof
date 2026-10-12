'use client';

import { useEffect, useRef } from 'react';

/**
 * THE HEADER'S REAL HEIGHT, FOR WHAT HANGS UNDER IT.
 *
 * The header is `--header-h` tall at normal text size, and everything that has
 * to clear it (the pinned run bar, the document's scroll padding) used to read
 * that number. With the text enlarged the header grows: its controls are
 * rem-sized, and on a phone the mode chip can drop to a second row (WCAG
 * 1.4.4). Then the header was drawn over the top of the pinned bar.
 *
 * This island renders an empty, hidden span inside the header and, through a
 * ResizeObserver, writes the header's measured height to `--header-live-h` on
 * the document root. CSS reads it through `--header-clear` (globals.css), which
 * falls back to `--header-h` until this has run, or where it never runs. At
 * normal text size the measured height IS `--header-h`, so nothing moves on load.
 *
 * Why measure, rather than drop the header's stickiness when it wraps: CSS
 * cannot tell that a row has wrapped, so that would need script as well, and it
 * would only cover the wrap. Root-size scaling makes the header taller without
 * any wrap at all.
 */
export const HEADER_LIVE_VAR = '--header-live-h';

export function HeaderHeightSync() {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const header = marker.current?.closest('header');
    if (!header || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const write = () => {
      root.style.setProperty(HEADER_LIVE_VAR, `${header.getBoundingClientRect().height}px`);
    };
    write();
    const observer = new ResizeObserver(write);
    observer.observe(header, { box: 'border-box' });
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEADER_LIVE_VAR);
    };
  }, []);

  return <span ref={marker} hidden />;
}
