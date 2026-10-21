import { Fragment } from 'react';
import { ModelId } from './ModelId';

const SEPARATOR = ' · ';
const DETECTOR = 'detector ';

/**
 * A PROVENANCE LINE THAT WRAPS ONLY BETWEEN ITS PARTS (owner ruling PROVENANCE
 * WRAP, 2026-10-21). "measured Aug 24, 2026 (UTC) · 51 test runs · graded 5
 * times each · detector claude-haiku-4-5" is four facts; a line may break
 * between them and never inside one, so each " · " segment is a no-wrap span
 * and the separators are where it can wrap. The detector's model is a
 * `ModelId`.
 *
 * `detectorOnOwnLine` (the metric cards): the detector segment starts a line of
 * its own, after everything else. The " · " before it is kept for a screen
 * reader and for a copy, and is not drawn, so the text is the line as built.
 */
export function ProvenanceLine({
  text,
  detectorOnOwnLine = false,
}: {
  text: string;
  detectorOnOwnLine?: boolean;
}) {
  const segments = text.split(SEPARATOR);
  return (
    <>
      {segments.map((segment, i) => {
        const detector = segment.startsWith(DETECTOR);
        const own = detector && detectorOnOwnLine;
        return (
          <Fragment key={i}>
            {i > 0 ? own ? <span className="sr-only">{SEPARATOR}</span> : SEPARATOR : null}
            <span
              data-provenance-segment={detector ? 'detector' : ''}
              className={own ? 'block whitespace-nowrap' : 'whitespace-nowrap'}
            >
              {detector ? (
                <>
                  {DETECTOR}
                  <ModelId id={segment.slice(DETECTOR.length)} />
                </>
              ) : (
                segment
              )}
            </span>
          </Fragment>
        );
      })}
    </>
  );
}
