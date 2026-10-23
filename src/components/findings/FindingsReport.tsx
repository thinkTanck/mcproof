import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { AsiLabel, StatusChip } from '@/components/hud';
import { stepMeta, stepPayload } from '@/components/replay/step-meta';
import { CoverageIcon } from '@/components/threats/CoverageIcon';
import { withStepNumber } from '@/lib/display/dates';
import { classificationDisplayProvenance } from '@/lib/display/measured';
import { RunProvenance } from '@/components/hud/RunProvenance';
import type { FixReport } from '@/fix-report';
import { CopyReportButton } from './CopyReportButton';
import { ModelId } from '@/components/hud/ModelId';
import { ProvenanceLine } from '@/components/hud/ProvenanceLine';

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
 * `report.provenance` says where the verdict came from. It is read off the report,
 * the same value the copied ticket prints, and it can be null: a run's provenance
 * is not this component's to invent, so when none was resolved, nothing is claimed.
 *
 * `routeId` is the id this report was opened under, which is the id the replay
 * of the same run lives at. It is optional for the same reason: `report.runId` is
 * NOT that id for a saved live run, so when the page does not supply one, no
 * replay link is drawn rather than one guessed from the wrong id.
 */
export function FindingsReport({
  report,
  routeId,
  provenanceLabel,
  runAt,
  hostedRunId,
}: {
  report: FixReport;
  routeId?: string;
  /**
   * The provenance as a person reads it, with human dates (2026-10-14). The
   * report keeps its ISO line for the copied ticket; without a label the
   * report's own line is drawn.
   */
  provenanceLabel?: string;
  /**
   * When a live run ran (ISO), so its day is drawn in the viewer's own time
   * zone (owner ruling 2026-10-15). Absent for a sample.
   */
  runAt?: string | null;
  /**
   * A live run's hosted MCP run id (`RunResult.runId`). Never printed on the
   * screen, which names the run by the id in its URL; the copied ticket carries
   * it under its own label, "Hosted run id".
   */
  hostedRunId?: string;
}) {
  const shownProvenance = provenanceLabel ?? report.provenance;
  // ONE RUN ID ON SCREEN (owner ruling 2026-10-15): the id in the URL. A saved
  // live run's `report.runId` is the hosted MCP run's id, a different string.
  const shownRunId = routeId ?? report.runId;
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
          <h1 className="reading-h1 mt-3 measure">
            {finding
              ? unreliable
                ? 'Agent compromised'
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
                ATTACK TYPE UNRELIABLE
              </span>
            ) : null}
            <p className="instrument">
              {finding ? (
                <>
                  {/* The code the judge returned, with that code's name. It is
                      never relabelled to the class the run staged; it only
                      gets its name, like any other code. */}
                  <AsiLabel code={finding.category} />
                  <span aria-hidden="true"> · </span>
                  SEV <span className="text-breach-text">{finding.severity}</span>
                  <span aria-hidden="true"> · </span>
                </>
              ) : null}
              run <span className="text-readout">{shownRunId}</span>
            </p>
          </div>
          <p className="instrument mt-(--instrument-stack) text-ink-faint">
            server <span className="text-readout">{report.target}</span>
            <span aria-hidden="true"> · </span>
            agent model <ModelId id={report.model} className="text-readout" />
          </p>
          {shownProvenance ? (
            <p className="instrument mt-(--instrument-stack) text-ink-faint">
              <RunProvenance text={shownProvenance} runAt={runAt} />
            </p>
          ) : null}
        </div>
        <CopyReportButton
          report={report}
          runId={shownRunId}
          {...(hostedRunId === undefined ? {} : { hostedRunId })}
        />
      </header>

      {finding && step ? (
        <>
          {/* Offending step (telemetry) + summary (prose), side by side on desktop */}
          {/* `grid-cols-1` is not decoration: an implicit single column is sized
              `auto`, so one unbreakable token in the payload (a long path) set
              the column wider than a phone screen and the page clipped it. */}
          <div className="mt-8 grid grid-cols-1 gap-7 border-t border-line pt-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <section aria-label="Step where it was compromised">
              <SectionHeading>Step where it was compromised</SectionHeading>
              <p className="readout mt-(--instrument-stack-rows) text-breach-text">
                {`#${finding.stepIndex} · ${stepMeta(step.type).label}`}
              </p>
              <dl
                data-asi-quoted="trace"
                className="mt-(--instrument-stack-rows) space-y-(--instrument-stack-rows)"
              >
                {stepPayload(step).map((row) => (
                  <div key={row.k} className="instrument flex gap-2">
                    <dt className="text-ink-faint">{row.k}</dt>
                    <dd className="min-w-0 break-words text-readout [overflow-wrap:anywhere]">
                      {row.v}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            {/* THE SUMMARY IS A CARD (UI audit 2026-10-13, batch F): the raised
                surface and `--elev-1`, asked for by `data-elev`. It is the one
                sentence that says what happened, so it is the one box on this
                page that is lifted. `self-start`, so the card is as tall as its
                sentence and not as tall as the payload beside it. */}
            <section
              aria-label="Summary"
              data-elev="1"
              className="self-start rounded-lg border border-line p-4"
            >
              <SectionHeading>Summary</SectionHeading>
              <p data-asi-quoted="generated-report" className="reading measure mt-2">
                {/* "Offending step: s2." reads "#2" on screen (2026-10-14); the
                    copied ticket keeps the generator's own text. */}
                {withStepNumber(report.summary, finding.stepId, finding.stepIndex)}
              </p>
            </section>
          </div>

          {/* Detector rationale (prose, quoted from the judge).
              QUOTED PROSE IS EVIDENCE AND IS PRINTED AS RECORDED (UI audit
              2026-10-12, batch C). The summary, the caveat, the note and the
              remediation come out of the frozen fix-report generator, and the
              rationale is the judge's own words. If one of them mentions a
              category code, it is not rewritten to add the name: each such
              paragraph is marked `data-asi-quoted` with where it came from,
              and the code is named in the page's own text around it (the
              header line, and the tally under a withheld remediation). */}
          <section aria-label="Detector's reasons" className="mt-7 border-t border-breach/30 pt-5">
            <SectionHeading>Detector&apos;s reasons</SectionHeading>
            <p data-asi-quoted="judge-rationale" className="reading measure mt-2">
              {finding.rationale}
            </p>
          </section>

          {/* Remediation — an ordered sequence, so numbering is meaningful.
              THE CATEGORY IS A PREDICTION, AND THIS LIST IS DERIVED FROM IT. The
              steps are keyed off the category the detector returned, and that
              category is the judge's own blind read of the trace, never a label
              (it is never shown `Trace.category`). So the list only appears when
              the measurement says the filing is worth deriving from. */}
          {finding.remediation && classification ? (
            <section aria-label="How to fix it" className="mt-7 border-t border-line-em/40 pt-5">
              <SectionHeading tone="cyan">How to fix it</SectionHeading>

              <div data-testid="classification-caveat" className="mt-3">
                <p data-asi-quoted="generated-report" className="reading measure">
                  {classification.caveat}
                </p>
                <p className="instrument mt-(--instrument-stack) text-ink-faint">
                  <ProvenanceLine text={classificationDisplayProvenance()} />
                </p>
              </div>

              <ol aria-label="How to fix it" className="mt-3">
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
                    <p data-asi-quoted="generated-report" className="reading measure">
                      {remedy}
                    </p>
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
              aria-label="No fix steps for this attack type"
              className="mt-7 border-t border-line-em/40 pt-5"
            >
              <SectionHeading>No fix steps for this attack type</SectionHeading>
              <div data-testid="classification-unreliable" className="mt-3">
                <p data-asi-quoted="generated-report" className="reading measure">
                  {classification.note}
                </p>
                <p className="instrument mt-(--instrument-stack)">
                  <span style={{ color: 'var(--status-inert)' }}>
                    {classification.staged} {classification.stagedTitle}: attack type named
                    correctly {classification.classScore.correct} of{' '}
                    {classification.classScore.scored} times in our tests
                  </span>
                </p>
                <p className="instrument mt-(--instrument-stack) text-ink-faint">
                  <ProvenanceLine text={classificationDisplayProvenance()} />
                </p>
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
          data-elev="1"
          className="mt-8 rounded-lg border border-line p-4"
        >
          <SectionHeading tone="cyan">Result</SectionHeading>
          <p data-asi-quoted="generated-report" className="reading mt-2 measure">
            {report.summary}
          </p>
          <p className="reading mt-3 measure text-ink-muted">
            This run finished and the detector graded it. It found no compromise, so there is
            nothing to fix.
          </p>
          {/* THE CLEAN RESULT'S OWN OFF-RAMP. A compromise ends somewhere (this
              report, and the ticket an engineer copies out of it); until now a
              clean run ended nowhere, which quietly ranked it below the other
              outcome. It ends on the leaderboard, which is what a clean run is
              evidence for. */}
          <p className="reading mt-3 measure">
            <Link
              href="/leaderboard"
              className="target-min inline-flex items-center text-nominal underline underline-offset-2 hover:text-readout"
            >
              See it on the leaderboard
            </Link>
          </p>
          {/* And back to the evidence: the replay of this same run, step by step. */}
          {routeId ? (
            <p className="reading mt-3 measure">
              <Link
                href={`/runs/${routeId}`}
                className="target-min inline-flex items-center text-nominal underline underline-offset-2 hover:text-readout"
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
