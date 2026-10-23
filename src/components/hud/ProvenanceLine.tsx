import { Fragment } from 'react';
import { ModelId } from './ModelId';

const SEPARATOR = ' · ';
const DETECTOR = 'detector ';

/**
 * A PROVENANCE LINE THAT WRAPS BETWEEN ITS PARTS (owner rulings PROVENANCE WRAP
 * and PROVENANCE WRAP 2, 2026-10-21 and 22). "measured Aug 24, 2026 (UTC) · 51
 * test runs · graded 5 times each · detector claude-haiku-4-5" is four facts;
 * each " · " segment is an inline block as wide as the line at most, so it
 * moves to the next line as a whole, and breaks inside itself only when the
 * segment alone is wider than the line (a 320 px screen, or the WCAG 1.4.12
 * spacing override), where it would otherwise be cut. The detector's model is
 * a `ModelId`, which never breaks at all.
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
              className={own ? 'block max-w-full' : 'inline-block max-w-full'}
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
