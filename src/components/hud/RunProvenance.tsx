import { humanDate, LIVE_GRADED_BY } from '@/lib/display/dates';
import { LocalDate } from './LocalDate';
import { ModelId } from './ModelId';

const DETECTOR = ' · detector ';

/**
 * A run's provenance line as a person reads it.
 *
 * A sample's line is fixed text with recorded dates, the same for every
 * reader, and is printed as given. A live run's line carries the day it ran,
 * and that day is the VIEWER'S (owner ruling 2026-10-15): "live run · run
 * Oct 15, 2026 · graded by the MCProof detector", with the date drawn by
 * `LocalDate`. The words around it are the ones `liveDisplayProvenance` builds,
 * so the server's text and this line read alike. A date that cannot be read
 * falls back to the text, which has already dropped it.
 */
export function RunProvenance({ text, runAt }: { text: string; runAt?: string | null }) {
  if (!runAt || humanDate(runAt) === null) {
    // The detector's model never breaks (PROVENANCE WRAP, 2026-10-21); the
    // rest of a sample's line wraps as it always has.
    const at = text.lastIndexOf(DETECTOR);
    if (at < 0) return <>{text}</>;
    return (
      <>
        {text.slice(0, at + DETECTOR.length)}
        <ModelId id={text.slice(at + DETECTOR.length)} />
      </>
    );
  }
  return (
    <>
      {'live run · '}
      <LocalDate iso={runAt} prefix="run " />
      {` · ${LIVE_GRADED_BY}`}
    </>
  );
}
