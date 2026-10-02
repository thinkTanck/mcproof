import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { StatusChip } from '@/components/hud';
import { stepMeta, stepPayload } from '@/components/replay/step-meta';
import { CoverageIcon } from '@/components/threats/CoverageIcon';
import type { FixReport } from '@/fix-report';
import { CopyReportButton } from './CopyReportButton';

/**
 * Section heading — an INSTRUMENT micro-label that is ALSO a real <h2>, so the
 * document keeps a clean heading outline (single h1 title → h2 sections) without
 * inventing a visible second-tier type. Tone tints the label per the design:
 * faint (default), cyan (remediation), breach (detector rationale).
 */
function SectionHeading({
  children,
  tone = 'faint',
}: {
  children: ReactNode;
  tone?: 'faint' | 'cyan' | 'breach';
}) {
  const toneClass =
    tone === 'cyan' ? 'text-nominal' : tone === 'breach' ? 'text-breach-text' : undefined;
  return <h2 className={cn('micro-label', toneClass)}>{children}</h2>;
}

/**
 * Findings / fix report — the editorial case file for a single run, rendered from
 * the REAL module-6 `FixReport` (`generateFixReport`). It used to render a
 * hand-authored fixture shaped to the screen while the generator shipped dark
 * behind it; everything here now binds from the artifact the product actually
 * produces.
 *
 * The header line reads `<category> · SEV <severity> · run <runId>` straight off
 * the record (no literals), the offending step is QUOTED from the observable
 * trace, and the prose blocks (rationale, remediation) render in the READING
 * register because they are sentences a human reads, not telemetry.
 *
 * `provenance` says where the verdict came from. It is optional because a live
 * run's provenance is not this component's to invent: the DataSource supplies it,
 * and when it cannot, nothing is claimed.
 *
 * `routeId` is the id this report was opened under, which is the id the replay
 * of the same run lives at. It is optional for the same reason: `report.runId` is
 * NOT that id for a saved live run, so when the page does not supply one, no
 * replay link is drawn rather than one guessed from the wrong id.
 */
export function FindingsReport({
  report,
  routeId,
  provenance,
}: {
  report: FixReport;
  routeId?: string;
  provenance?: string | null;
}) {
  const finding = report.finding;
  const step = finding?.step;
  const classification = finding?.classification;
  // A class the measurement scored at ZERO. The screen keeps everything that was
  // measured to work (the compromise, the anchored step, the rationale) and
  // withholds the one thing derived from the code that never came out right.
  const unreliable = classification !== undefined && !classification.reliable;

  return (
    <article aria-label="Fix report" className="mx-auto max-w-[1440px] px-6 py-10 md:py-12">
      {/* Header: title + status + provenance line, with the copy control */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {/* The kicker names what this page IS, and that depends on the verdict.
              A clean run opening under "Fix report" tells the reader they are
              looking at a fix report that failed to materialize; it is a run
              result, and both results are first-class. */}
          <p className="micro-label text-nominal">
            {finding ? 'Findings · Fix report' : 'Findings · Run result'}
          </p>
          {/* The headline is the strongest claim on the page, so it states only
              what survived measurement. For a class that classified at zero the
              category title would be that claim, and it is the part we cannot
              stand behind; the confirmed compromise is. */}
          {/* A run with no finding is a RESULT, and the headline says which
              result it is. "No findings" reads like an absence, and the absence
              of a compromise on a hostile surface is the agent doing its job. */}
          <h1 className="reading-h1 mt-3 max-w-[640px]">
            {finding
              ? unreliable
                ? 'Compromise confirmed'
                : finding.categoryTitle
              : 'Agent resisted'}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <StatusChip
              state={report.compromised ? 'breach' : 'nominal'}
              label={report.compromised ? 'COMPROMISED' : 'NOT COMPROMISED'}
            />
            {unreliable ? (
              // The neutral fourth state (`--status-inert`), never the breach red:
              // an unreliable filing is not a second breach, and red is reserved
              // for an actual compromise (ADR-0003). Icon AND label, never color
              // alone.
              <span
                data-testid="classification-badge"
                className="inline-flex items-center gap-2 rounded-full border border-line px-2.5 py-1 font-mono text-[13px] uppercase tracking-[0.12em]"
                style={{ color: 'var(--status-inert)' }}
              >
                <CoverageIcon kind="inert" size={12} />
                CLASSIFICATION UNRELIABLE
              </span>
            ) : null}
            <p className="instrument">
              {finding ? (
                <>
                  <span>{finding.category}</span>
                  <span aria-hidden="true"> · </span>
                  SEV <span className="text-breach-text">{finding.severity}</span>
                  <span aria-hidden="true"> · </span>
                </>
              ) : null}
              run <span className="text-readout">{report.runId}</span>
            </p>
          </div>
          <p className="instrument mt-2 text-ink-faint">
            target <span className="text-readout">{report.target}</span>
            <span aria-hidden="true"> · </span>
            model <span className="text-readout">{report.model}</span>
          </p>
          {provenance ? <p className="instrument mt-1 text-ink-faint">{provenance}</p> : null}
        </div>
        <CopyReportButton report={report} />
      </header>

      {finding && step ? (
        <>
          {/* Offending step (telemetry) + summary (prose), side by side on desktop */}
          <div className="mt-8 grid gap-7 border-t border-line pt-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <section aria-label="Offending step">
              <SectionHeading>Offending step</SectionHeading>
              <p className="readout mt-2 text-breach-text">
                {`#${finding.stepIndex} · ${stepMeta(step.type).label}`}
              </p>
              <dl className="mt-2 space-y-1">
                {stepPayload(step).map((row) => (
                  <div key={row.k} className="instrument flex gap-2">
                    <dt className="text-ink-faint">{row.k}</dt>
                    <dd className="min-w-0 break-words text-readout">{row.v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-label="Summary">
              <SectionHeading>Summary</SectionHeading>
              <p className="reading mt-2">{report.summary}</p>
            </section>
          </div>

          {/* Detector rationale (prose, quoted from the judge) */}
          <section aria-label="Detector rationale" className="mt-7 border-t border-breach/30 pt-5">
            <SectionHeading tone="breach">Detector rationale</SectionHeading>
            <p className="reading mt-2">{finding.rationale}</p>
          </section>

          {/* Remediation — an ordered sequence, so numbering is meaningful.
              THE CATEGORY IS A PREDICTION, AND THIS LIST IS DERIVED FROM IT. The
              steps are keyed off the category the detector returned, and that
              category is the judge's own blind read of the trace, never a label
              (it is never shown `Trace.category`). So the list only appears when
              the measurement says the filing is worth deriving from. */}
          {finding.remediation && classification ? (
            <section aria-label="Remediation" className="mt-7 border-t border-line-em/40 pt-5">
              <SectionHeading tone="cyan">Remediation</SectionHeading>

              <div data-testid="classification-caveat" className="mt-3">
                <p className="reading">
                  The category above is the detector’s own blind classification of the trace, and
                  these steps follow from it. Measured accuracy on our labeled set is{' '}
                  {classification.accuracy.toFixed(2)}, so confirm the category against the
                  offending step before you act on this list.
                </p>
                <p className="instrument mt-2 text-ink-faint">{classification.provenance}</p>
              </div>

              <ol aria-label="Remediation" className="mt-3">
                {finding.remediation.steps.map((remedy, i) => (
                  <li
                    key={remedy}
                    className="flex items-baseline gap-4 border-t border-line/60 py-3 first:border-t-0"
                  >
                    <span
                      aria-hidden="true"
                      className="min-w-[1.75rem] font-sans text-[20px] font-semibold text-nominal"
                    >
                      {i + 1}
                    </span>
                    <p className="reading">{remedy}</p>
                  </li>
                ))}
              </ol>
              <p className="instrument mt-4 text-ink-faint">{finding.remediation.reference}</p>
            </section>
          ) : classification ? (
            /* WITHHELD, and it says so in full. The neighbouring category's
               actions are not printed at a lower confidence, because a list an
               engineer can work top to bottom IS the authoritative claim,
               whatever hedge sits above it. */
            <section
              aria-label="Remediation withheld"
              className="mt-7 border-t border-line-em/40 pt-5"
            >
              <SectionHeading>Remediation withheld</SectionHeading>
              <div data-testid="classification-unreliable" className="mt-3">
                <p className="reading max-w-[72ch]">{classification.note}</p>
                <p className="instrument mt-3">
                  <span style={{ color: 'var(--status-inert)' }}>
                    {classification.staged} {classification.stagedTitle} filed correctly{' '}
                    {classification.classScore.correct} of {classification.classScore.scored}
                  </span>
                </p>
                <p className="instrument mt-1 text-ink-faint">{classification.provenance}</p>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        /* THE CLEAN-RESISTANCE RESULT. The run finished, the detector judged it,
           and there is no finding. That is a first-class outcome of the product,
           so it gets a real section that says what happened and what it means,
           not a shrug. It is deliberately NOT the missing-report state
           (`FindingsEmpty`), which is a different fact about a different id. */
        <section
          aria-label="Summary"
          data-testid="clean-result"
          className="mt-8 border-t border-line pt-6"
        >
          <SectionHeading tone="cyan">Result</SectionHeading>
          <p className="reading mt-2 max-w-[640px]">{report.summary}</p>
          <p className="reading mt-3 max-w-[640px] text-ink-muted">
            This run finished and the detector judged it. A run with no findings is a result, not a
            missing report: there is nothing here to fix.
          </p>
          {/* THE CLEAN RESULT'S OWN OFF-RAMP. A compromise ends somewhere (this
              report, and the ticket an engineer copies out of it); until now a
              clean run ended nowhere, which quietly ranked it below the other
              outcome. It ends on the leaderboard, which is what a clean run is
              evidence for. */}
          <p className="reading mt-3 max-w-[640px]">
            <Link
              href="/leaderboard"
              className="text-nominal underline underline-offset-2 hover:text-readout"
            >
              See it on the robustness leaderboard
            </Link>
          </p>
          {/* And back to the evidence: the replay of this same run, step by step. */}
          {routeId ? (
            <p className="reading mt-3 max-w-[640px]">
              <Link
                href={`/runs/${routeId}`}
                className="text-nominal underline underline-offset-2 hover:text-readout"
              >
                Open the replay of this run
              </Link>
            </p>
          ) : null}
        </section>
      )}
    </article>
  );
}
