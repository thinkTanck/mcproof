'use client';

import { useEffect, useState } from 'react';

/**
 * THE SWIPE CUE TELLS THE TRUTH (owner ruling 2026-10-18). It used to be
 * printed at every width, so on a laptop it told the reader to swipe a table
 * that already showed every column. Now it measures the scroll region it
 * names: shown only when the table overflows it (`scrollWidth > clientWidth`),
 * and measured again whenever the region or the window changes size.
 *
 * BEFORE IT HAS MEASURED (the server's render, and the moment before the
 * browser answers) it guesses from the width, shown below 1024px and hidden
 * from there up, which is where the board stops overflowing in the shell
 * (measured 2026-10-18: it overflows at 900 and fits at 1024, 1280 and 1440;
 * it overflows again for a few pixels from 1100, where the shell's wide header
 * and rail take their room, which the measurement then catches). The
 * measurement decides, at any width.
 *
 * It is one sentence, so it wears the READING role in the muted tone, and it
 * is not a live region: it describes the table and announces nothing.
 */
export function SwipeCue({ regionId, count }: { regionId: string; count: number }) {
  const [overflow, setOverflow] = useState<boolean | null>(null);

  useEffect(() => {
    const region = document.getElementById(regionId);
    if (!region) return;
    let live = true;
    const measure = () => {
      if (live) setOverflow(region.scrollWidth > region.clientWidth);
    };
    measure();
    window.addEventListener('resize', measure);
    // The region's own box, AND the table inside it: when the web font lands
    // the table grows while the region keeps its size, and watching the region
    // alone left the first, fallback-font answer standing.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(region);
    if (region.firstElementChild) observer?.observe(region.firstElementChild);
    void document.fonts?.ready.then(measure);
    return () => {
      live = false;
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [regionId]);

  return (
    <p
      data-swipe-cue={regionId}
      data-overflow={overflow === null ? undefined : String(overflow)}
      hidden={overflow === false}
      className={
        'reading mb-2.5 flex items-center gap-2 text-ink-muted' +
        (overflow === null ? ' lg:hidden' : '')
      }
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M6 3 2 8l4 5M10 3l4 5-4 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Swipe the table left to see all {count} attack types.
    </p>
  );
}
