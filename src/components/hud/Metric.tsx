/**
 * ONE MEASURED FIGURE, DRAWN ONE WAY (UI audit 2026-10-12, batch D).
 *
 * Precision, recall and category classification accuracy used to be drawn by
 * hand, at two sizes, with a one-word label each. This draws any one of them:
 * the label in the INSTRUMENT role, the value in DISPLAY, and a plain sentence
 * saying what the figure measures in READING. Every figure on a page is the
 * same size because there is no way to ask this for another one: it takes no
 * class and no size.
 *
 * WHAT IT DOES NOT DO, on purpose. It draws ONE figure and knows nothing about
 * where the figure came from. The compromise call and the category
 * classification are two measurements with their own denominators, so the page
 * keeps them in two groups, each with its own provenance line beside its own
 * figures; this component can never merge them, because it never sees two.
 *
 * The value is printed as it is given, on the first paint. A measured figure
 * is evidence and is never counted up.
 *
 * It is a term and its descriptions, so it sits inside a `<dl>`, and the term
 * and both descriptions are direct children of the one wrapper a `<dl>` allows.
 * The label comes first in the document, so a screen reader meets the name
 * before the number; the grid draws the number first, as the thing being read,
 * with the label beside it and the sentence under both. A label too long for
 * its column wraps, and breaks inside a word before it would run off a phone.
 */
export function Metric({
  id,
  label,
  value,
  meaning,
}: {
  /** A stable name for this figure, e.g. `precision`. */
  id: string;
  /** What the figure is called. */
  label: string;
  /** The figure, already formatted. */
  value: string;
  /** One plain sentence: what the figure measures. */
  meaning: string;
}) {
  return (
    <div
      data-metric={id}
      className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1"
    >
      <dt
        data-metric-label=""
        className="micro-label col-start-2 row-start-1 [overflow-wrap:anywhere]"
      >
        {label}
      </dt>
      <dd data-metric-value="" className="display-lg col-start-1 row-start-1 font-sans">
        {value}
      </dd>
      <dd data-metric-meaning="" className="reading measure col-span-2">
        {meaning}
      </dd>
    </div>
  );
}
