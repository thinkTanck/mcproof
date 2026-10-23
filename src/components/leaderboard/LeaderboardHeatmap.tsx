import Link from 'next/link';
import { cn } from '@/lib/utils';
import { bandFor, bandToken, type Band } from '@/lib/hud/bands';
import type { Leaderboard, LeaderboardCell } from '@/data/source';
import { BandShape } from './BandShape';
import { CountUp } from './CountUp';
import { InertMark } from './InertMark';
import { SwipeCue } from './SwipeCue';
import { ModelId } from '@/components/hud/ModelId';

/**
 * ROBUSTNESS LEADERBOARD heatmap (register: PRODUCT). A model × category matrix
 * plus an OVERALL column; the robustness value is the HERO of every cell.
 *
 * GENERIC over `leaderboard.categories.length` — it renders N category columns
 * from the data (the Core-7 makes it 7). Tri-state by threshold with THREE
 * channels so a cell never reads by colour alone: (1) a shape code (○ △ ◇),
 * (2) the band label named in the cell's accessible text, (3) the tinted value,
 * plus the reserved breach glow on the single weakest cell.
 *
 * THREE CELL STATES, and telling them apart is the point of this component:
 *
 *   MEASURED — real persisted runs. Carries its run count (`n=K`) under the
 *              value, because a measured ratio without its sample size is half
 *              a claim.
 *   FIXTURE  — placeholder runs that demonstrate the aggregation. Says so in
 *              every cell's accessible name, shows NO run count (there is no
 *              evidence to size), and the whole board wears a FIXTURE readout.
 *   NO DATA  — no runs behind this pair. Rendered in the neutral
 *              `--status-inert` token with the words "No data", NEVER as 0.00
 *              and never in breach red: a category nobody has run is not a
 *              category the model failed (ADR-0003).
 *
 * DRILL-IN IS OPTIONAL, and its absence is deliberate rather than unfinished. A
 * cell links to a replay only when the caller can name a run the replay can
 * actually serve. A measured cell has no such route yet, and pointing it at the
 * sample run for its category would open a constructed demonstration under the
 * label of somebody's real measurement.
 *
 * 2-D data can't reflow to a stacked list, so on narrow viewports it becomes a
 * horizontal-scroll heatmap with a sticky model column + a visible swipe cue
 * (legitimate under WCAG 1.4.10's two-dimensional-data exception). The scroll
 * region is focusable + labelled so it is keyboard-operable.
 */

/** Per-band presentation: value/shape colour + resting tint. Colour is one of
 *  three redundant channels, never the only one. Breach value uses the higher
 *  contrast red-200 text token (large-text AA with headroom). */
const TONE: Record<Band, { value: string; tint: string }> = {
  nominal: { value: 'text-nominal', tint: 'bg-nominal/[0.06]' },
  caution: { value: 'text-caution', tint: 'bg-caution/[0.07]' },
  breach: { value: 'text-breach-text', tint: 'bg-breach/[0.12]' },
};

const fmt = (n: number) => n.toFixed(2);

/** The one scroll region on the page, which the swipe cue measures. */
const SCROLL_REGION_ID = 'leaderboard-scroll';

/** A cell that has runs behind it, so it has a number and a provenance. */
type ScoredCell = Extract<LeaderboardCell, { robustness: number }>;

const isScored = (c: LeaderboardCell): c is ScoredCell => c.robustness !== null;

function CellShapeAndValue({ cell }: { cell: ScoredCell }) {
  const band = bandFor(cell.robustness);
  const tone = TONE[band];
  return (
    <span className="flex flex-col items-center gap-1.5">
      <span className={cn('display-md font-mono', tone.value)}>{fmt(cell.robustness)}</span>
      <BandShape band={band} className={tone.value} />
      {/* A measured ratio carries its sample size; a fixture has no evidence to
          size and deliberately shows none. That difference is visible in every
          cell, not only in the board's readout. */}
      {cell.state === 'measured' ? (
        <span aria-hidden="true" className="instrument-faint one-line">
          n={cell.runs}
        </span>
      ) : null}
    </span>
  );
}

export function LeaderboardHeatmap({ leaderboard }: { leaderboard: Leaderboard }) {
  const { categories, rows, source } = leaderboard;
  const measured = source === 'measured';
  // One board per page, so a fixed prefix is enough for the legend's entry ids.
  const legendId = 'leaderboard-category';

  const provenanceWord = measured ? 'measured' : 'fixture';
  // Suffix carried in every scored cell's accessible name, so provenance is not
  // something a screen-reader user has to go and find in a chip elsewhere.
  const cellProvenance = measured ? '' : ', fixture data';

  // The design names "the worst cell" as this screen's single focal point. Find
  // it among the cells that HAVE data: a blank cell is not a weak one.
  const scored = rows.flatMap((row) => row.cells).filter(isScored);
  const lowest = scored.reduce<ScoredCell | null>(
    (min, c) => (min === null || c.robustness < min.robustness ? c : min),
    null,
  );
  // Every scored cell held on every run (owner ruling 2026-10-20): there is
  // nothing weak to point at, so the callout says so and no cell is marked.
  const noneCompromised = lowest !== null && lowest.robustness >= 1;
  const weakest = noneCompromised ? null : lowest;
  const weakestBand = weakest ? bandFor(weakest.robustness) : null;
  const weakestFull = weakest
    ? (categories.find((cat) => cat.id === weakest.category)?.full ?? weakest.category)
    : '';

  const weakestLabel = measured ? 'Weakest' : 'Weakest fixture cell';
  const weakestBody =
    weakest && weakestBand ? (
      <>
        <span className={cn('micro-label', measured ? 'text-breach-text' : '')}>
          {weakestLabel}
        </span>
        <span className={cn('display-md font-mono', TONE[weakestBand].value)}>
          {fmt(weakest.robustness)}
        </span>
        <BandShape band={weakestBand} className={TONE[weakestBand].value} />
        <ModelId id={weakest.model} className="font-mono text-[14px] text-ink-hi" />
        <span className="font-mono text-[13px] text-ink-muted">
          {weakest.category} · {weakestFull}
        </span>
      </>
    ) : null;

  // The breach glow is a signal about a real run, so a fixture board does not
  // get to wear it. The callout still exists there (the design's focal move),
  // it just stops looking like a finding.
  const weakestFrame = measured
    ? 'border-breach/40 bg-breach/5 shadow-glow-breach'
    : 'border-line bg-solid';
  const weakestAria =
    weakest && weakestBand
      ? `${weakestLabel}: ${weakest.model} ${weakest.category} ${weakestFull}, robustness ${fmt(
          weakest.robustness,
        )}, ${bandToken(weakestBand).label}${cellProvenance}.`
      : '';

  return (
    <figure className="m-0">
      {noneCompromised ? (
        <p
          data-weakest=""
          className="mb-4 inline-flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-line bg-solid px-3.5 py-2.5 text-[15px] text-ink"
        >
          No compromises in your measured runs
        </p>
      ) : null}
      {weakestBody ? (
        <p
          data-weakest=""
          className={cn(
            'mb-4 inline-flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border px-3.5 py-2.5',
            weakestFrame,
          )}
        >
          {/* One sentence for assistive tech, the HUD readout for everyone else,
              so the same fact is not announced twice. */}
          <span className="sr-only">{weakestAria}</span>
          <span aria-hidden="true" className="contents">
            {weakestBody}
          </span>
        </p>
      ) : null}

      {/* Legend + provenance — INSTRUMENT telemetry (mono, terse). */}
      <figcaption className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex items-center gap-2 font-mono text-[13px] tracking-[0.04em] text-ink-muted">
          <span className="text-nominal">
            <BandShape band="nominal" />
          </span>
          <span aria-hidden="true">&#8805;.80</span>
          <span className="sr-only">nominal, greater than or equal to .80</span>
        </span>
        <span className="flex items-center gap-2 font-mono text-[13px] tracking-[0.04em] text-ink-muted">
          <span className="text-caution">
            <BandShape band="caution" />
          </span>
          .50 to .79
          <span className="sr-only">caution</span>
        </span>
        <span className="flex items-center gap-2 font-mono text-[13px] tracking-[0.04em] text-ink-muted">
          <span className="text-breach-text">
            <BandShape band="breach" />
          </span>
          <span aria-hidden="true">&lt;.50</span>
          <span className="sr-only">breach, less than .50</span>
        </span>
        <span
          className="flex items-center gap-2 font-mono text-[13px] tracking-[0.04em]"
          style={{ color: 'var(--status-inert)' }}
        >
          <InertMark />
          No data
          <span className="sr-only">no runs, not measured</span>
        </span>
        {/* A visible, touch/keyboard-reachable path to the category names (the column
            codes' full names + explanations live on the coverage board). */}
        {/* A link sitting alone in a legend row is not covered by the
            inline-text exception, so it is a full `--target-min` target. */}
        <Link
          href="/threats"
          className="target-min inline-flex items-center font-mono text-[13px] tracking-[0.04em] text-nominal hover:underline"
        >
          Category names → Threats
        </Link>
        <span
          className="ml-auto inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[13px] uppercase tracking-[0.12em]"
          style={
            measured
              ? undefined
              : { color: 'var(--status-inert)', borderColor: 'var(--status-inert)' }
          }
        >
          <span
            aria-hidden="true"
            className={cn('h-1.5 w-1.5 rounded-full', measured && 'bg-nominal')}
            style={measured ? undefined : { backgroundColor: 'var(--status-inert)' }}
          />
          SOURCE · {provenanceWord}
        </span>
      </figcaption>

      {/* THE COLUMN CODES, NAMED (UI audit 2026-10-12, batch C). A column is
          too narrow for the longest of the names (the supply chain one), and
          a `title` on the header was a tooltip no finger or keyboard could
          reach. So the names are a legend in plain sight directly above the
          table, one entry per column, and each column header points at its
          entry with `aria-describedby`. */}
      <ul
        aria-label="Category names"
        className="mb-(--instrument-stack) flex flex-wrap gap-x-5 gap-y-(--instrument-stack-rows)"
      >
        {categories.map((c) => (
          <li key={c.id} id={`${legendId}-${c.id}`} className="instrument">
            <span className="text-ink-hi">{c.id}</span> {c.full}
          </li>
        ))}
      </ul>

      {/* Swipe / scroll affordance, drawn only when the table really overflows
          its region (owner ruling 2026-10-18): measured in the browser, so it
          is never shown at a width where every column fits. */}
      <SwipeCue regionId={SCROLL_REGION_ID} count={categories.length} />

      {/* Focusable, labelled 2-D scroll region. */}
      <div className="relative">
        <div
          id={SCROLL_REGION_ID}
          role="region"
          aria-label={`${measured ? 'Measured' : 'Fixture'} model by category robustness heatmap`}
          tabIndex={0}
          className="overflow-x-auto border-y border-line"
        >
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              For each agent model and attack type: the share of runs where the agent was not
              compromised. Higher is safer.{' '}
              {measured
                ? 'Measured from persisted runs; each cell also states how many runs it counted.'
                : 'Fixture data, not a claimed benchmark. Each value cell links to that run in Replay.'}{' '}
              A cell with no runs says No data.
            </caption>
            <thead>
              <tr className="bg-[color:var(--navy-900)]">
                <th
                  scope="col"
                  data-sticky="model"
                  className="sticky left-0 z-20 min-w-[132px] border-b border-line bg-solid px-3.5 py-2.5 font-mono text-[13px] font-medium uppercase tracking-[0.12em] text-ink-faint"
                >
                  Model
                </th>
                {categories.map((c) => (
                  <th
                    key={c.id}
                    scope="col"
                    aria-describedby={`${legendId}-${c.id}`}
                    className="min-w-[86px] border-b border-l border-line px-2 py-2.5 text-center align-bottom font-mono text-[13px] font-medium tracking-[0.04em] text-ink"
                  >
                    <span aria-hidden="true">{c.id}</span>
                    <span className="sr-only">
                      {c.id} {c.full}
                    </span>
                  </th>
                ))}
                <th
                  scope="col"
                  className="min-w-[104px] border-b border-l border-r border-line px-3.5 py-2.5 text-right font-mono text-[13px] font-medium uppercase tracking-[0.12em] text-ink-faint"
                >
                  Overall
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const overallBand = row.overall === null ? null : bandFor(row.overall);
                return (
                  <tr key={row.model}>
                    <th
                      scope="row"
                      data-sticky="model"
                      className="sticky left-0 z-10 border-b border-line bg-solid px-3.5 py-3 text-left"
                    >
                      <span className="flex items-center gap-2.5">
                        <span
                          aria-hidden="true"
                          className={cn('h-2 w-2 shrink-0 rounded-full', {
                            'bg-nominal': overallBand === 'nominal',
                            'bg-caution': overallBand === 'caution',
                            'bg-breach': overallBand === 'breach',
                            'bg-[color:var(--status-inert)]': overallBand === null,
                          })}
                        />
                        <ModelId id={row.model} className="font-mono text-[14px] text-ink-hi" />
                      </span>
                    </th>
                    {row.cells.map((c) => {
                      if (!isScored(c)) {
                        return (
                          <td
                            key={c.category}
                            data-cell-state="none"
                            className="border-b border-l border-line p-0"
                          >
                            <span
                              className="flex min-h-[52px] flex-col items-center justify-center gap-1.5 px-2 py-3"
                              style={{ color: 'var(--status-inert)' }}
                            >
                              <InertMark />
                              <span className="font-mono text-[13px] uppercase tracking-[0.1em]">
                                No data
                              </span>
                            </span>
                          </td>
                        );
                      }
                      const band = bandFor(c.robustness);
                      const label = bandToken(band).label;
                      const category = categories.find((cat) => cat.id === c.category);
                      const full = category ? category.full : c.category;
                      const isWorst = c === weakest;
                      const name = `${row.model} · ${c.category} ${full}: robustness ${fmt(
                        c.robustness,
                      )}, ${label}${
                        c.state === 'measured' ? `, measured over ${c.runs} runs` : cellProvenance
                      }${isWorst ? ', the weakest cell' : ''}.`;
                      const inner = <CellShapeAndValue cell={c} />;
                      return (
                        <td
                          key={c.category}
                          data-cell-state={c.state}
                          className={cn('border-b border-l border-line p-0', TONE[band].tint)}
                        >
                          <span
                            className={cn(
                              'flex min-h-[52px] items-center justify-center px-2 py-3',
                              isWorst &&
                                measured &&
                                'ring-2 ring-inset ring-breach/70 shadow-glow-breach',
                            )}
                          >
                            <span className="sr-only">{name}</span>
                            <span aria-hidden="true" className="contents">
                              {inner}
                            </span>
                          </span>
                        </td>
                      );
                    })}
                    {row.overall === null || overallBand === null ? (
                      // No valid run left to score: No data, never 0.
                      <td
                        data-overall=""
                        data-cell-state="none"
                        className="border-b border-l border-r border-line px-3.5 py-3 text-right"
                        style={{ color: 'var(--status-inert)' }}
                      >
                        <span className="inline-flex items-center gap-1.5 font-mono text-[13px] uppercase tracking-[0.1em]">
                          <InertMark />
                          No data
                        </span>
                      </td>
                    ) : (
                      <td
                        data-overall=""
                        className="border-b border-l border-r border-line px-3.5 py-3 text-right"
                      >
                        <CountUp
                          value={row.overall}
                          className={cn('display-md font-mono', TONE[overallBand].value)}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </figure>
  );
}
