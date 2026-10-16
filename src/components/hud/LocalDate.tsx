'use client';

import { useSyncExternalStore } from 'react';
import { humanDate, localDate } from '@/lib/display/dates';

/**
 * A LIVE RUN'S DATE, IN THE VIEWER'S OWN TIME ZONE (owner ruling 2026-10-15).
 *
 * The run pages are drawn on the server, which cannot know where the reader
 * is. So the server sends the UTC day (`humanDate`), and once the page has
 * hydrated the browser draws the reader's own day (`localDate`) in its place.
 * React reads the server's value while hydrating and the browser's straight
 * after (`useSyncExternalStore`), so the two never clash; the text carries
 * `suppressHydrationWarning` as well, for a reader whose day is the UTC day
 * only by a hair. The `<time>` element always carries the ISO value, and the
 * data, the exports and the copied ticket keep ISO.
 *
 * Only for a live run's own date. A recorded date (the day the samples were
 * constructed and judged, the day the detector was measured) is the same for
 * every reader and is printed with `humanDate`.
 */
const subscribe = () => () => {};

export function LocalDate({
  iso,
  prefix = '',
  className,
}: {
  /** The ISO timestamp, as stored. */
  iso: string;
  /** Words before the date, inside the same `<time>`, e.g. "run ". */
  prefix?: string;
  className?: string;
}) {
  const day = useSyncExternalStore(
    subscribe,
    () => localDate(iso),
    () => humanDate(iso),
  );
  if (day === null) return null;
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {`${prefix}${day}`}
    </time>
  );
}
