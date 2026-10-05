import Link from 'next/link';
import { CoverageIcon } from './CoverageIcon';
import type { Threat } from './threat-data';

/**
 * One category row on the coverage board. Left rail: the code (INSTRUMENT ·
 * mono display), the title (READING heading, PINNED verbatim), and the coverage
 * badge (icon + text label). Right column: the editorial explanation in READING
 * roles (plain summary, how it works, example, coverage rationale).
 *
 * State color: covered → `text-nominal` + glow; inert → the neutral
 * `--status-inert` token, NO glow, NEVER red.
 */
export function ThreatEntry({
  threat,
  sampleHref = '/runs/sample',
}: {
  threat: Threat;
  /**
   * Where the covered "watch a real run" button points: this threat's OWN
   * category sample run, derived by the page from the sample library. Defaults to
   * the featured sample only as a fallback when a category's run id is missing.
   */
  sampleHref?: string;
}) {
  const covered = threat.state === 'covered';
  // Inert color comes from the neutral token via inline style so it resolves at
  // integration; covered color rides the semantic `text-nominal` utility.
  const stateStyle = covered ? undefined : { color: 'var(--status-inert)' };

  const badgeLabel = covered ? 'COVERED' : 'NOT MEASURABLE';
  const coverLabel = covered ? 'COVERAGE' : 'WHY IT’S OUT OF SCOPE';

  return (
    <article
      data-testid={`threat-${threat.code}`}
      data-state={threat.state}
      className="grid gap-6 border-b border-line py-8 md:grid-cols-[minmax(0,13rem)_1fr] md:gap-10"
    >
      {/* Left rail — code · title · state badge */}
      <div className="flex flex-col gap-3">
        <span
          className="font-mono text-[20px] leading-none tracking-tight"
          style={covered ? { color: 'var(--status-nominal)' } : stateStyle}
        >
          {threat.code}
        </span>
        <h2 className="reading-h3 font-semibold">{threat.title}</h2>
        <span
          className={
            'inline-flex w-fit items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[13px] uppercase tracking-[0.12em] ' +
            (covered
              ? 'border-line-em bg-nominal/5 text-nominal shadow-glow-nominal'
              : 'border-line')
          }
          style={stateStyle}
        >
          <CoverageIcon kind={threat.state} size={12} />
          {badgeLabel}
        </span>
      </div>

      {/* Right column — the editorial explanation (READING roles) */}
      <div className="flex min-w-0 flex-col gap-5">
        <p className="reading-lead measure">{threat.plain}</p>

        <div>
          <div className="micro-label mb-1.5">HOW IT WORKS</div>
          <p className="reading measure">{threat.how}</p>
        </div>

        <div>
          <div className="micro-label mb-1.5">EXAMPLE</div>
          <p className="reading measure">{threat.example}</p>
        </div>

        <div className="rounded-md border border-line bg-base/40 px-4 py-3">
          <div className="micro-label mb-1.5" style={covered ? undefined : stateStyle}>
            {coverLabel}
          </div>
          <p className="reading measure">{threat.coverText}</p>
        </div>

        {/* A MEASURED caveat, where one was measured. Inert token, no glow,
            never red: this qualifies HOW WELL a covered category is handled, it
            does not downgrade the coverage state or signal a breach. */}
        {threat.caveat && (
          <div
            data-testid={`threat-caveat-${threat.code}`}
            className="rounded-md border border-line px-4 py-3"
          >
            <div
              className="micro-label mb-1.5 inline-flex items-center gap-2"
              style={{ color: 'var(--status-inert)' }}
            >
              <CoverageIcon kind="inert" size={12} />
              {threat.caveat.label}
            </div>
            <p className="reading measure">{threat.caveat.text}</p>
            <p className="instrument-faint mt-2">{threat.caveat.provenance}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {covered && (
            <Link
              href={sampleHref}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line-em bg-nominal/10 px-3 py-1.5 font-mono text-[13px] tracking-[0.06em] text-readout"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                <polygon points="2,1 11,6 2,11" fill="currentColor" />
              </svg>
              WATCH A REAL RUN
            </Link>
          )}
          {!covered && (
            <Link
              href="#measurability"
              className="inline-flex min-h-11 items-center font-mono text-[13px] tracking-[0.04em] text-nominal hover:underline"
            >
              Measurability bar →
            </Link>
          )}
          <a
            href={threat.link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`OWASP reference for ${threat.code} on genai.owasp.org`}
            className="inline-flex min-h-11 items-center font-mono text-[13px] tracking-[0.04em] text-nominal"
          >
            OWASP reference →
          </a>
        </div>
      </div>
    </article>
  );
}
