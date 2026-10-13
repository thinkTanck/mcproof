'use client';

import { useEffect, useState } from 'react';
import type { RunResult } from '@/contract';
import { AsiLabel, StatusChip } from '@/components/hud';
import { ReplayTerminal } from './ReplayTerminal';
import { Transport } from './Transport';
import { StepDetail } from './StepDetail';
import { VerdictRail } from './VerdictRail';
import { REPLAY_KEY_ID, ReplayKey, transcriptKeyEntries } from './ReplayKey';
import { useReplayLayout } from './phone-layout';

/**
 * Live Attack Replay (the hero) — two terminals over a full-width transport. The
 * transcript terminal streams the run's real input/output as a bash session; the
 * verdict terminal prints the detector's summary + an export prompt. The transport
 * (full width) and the step-detail box sit beneath both. The step-detail panel is
 * fixed-height, so advancing never reflows the page (no CLS).
 *
 * ON A PHONE (Part D; narrower than 768px, or a phone on its side) the order is
 * terminal, transport, verdict, in the DOCUMENT, so Tab and a screen reader meet
 * the controls where they are seen. The terminal and the transport share one box
 * capped at a viewport under the header, the terminal shrinking to fit and
 * scrolling inside itself. Nothing is pinned. The server cannot see the width,
 * so it sends the transport in both places and CSS shows the one that fits (no
 * reflow on hydration); once the browser answers, only that one is kept. From
 * 768px up nothing here applies and the replay is as it was.
 *
 * THE COLOUR KEY (UI audit 2026-10-12, batch D) is the LAST thing on the stage,
 * under the step detail, at every width. The transcript draws its prompts in
 * one colour, its step text in another and the compromise step in red with a
 * diamond, and the key says so in words. Last, so it pushes nothing down: the
 * terminal, the controls, the verdict and the step detail are where they
 * were, on a phone as well. The transcript's list points at it with
 * `aria-describedby`. It is static text and not a live region; the step detail
 * stays the one live region here.
 */
const SPEEDS = [0.5, 1, 2, 4];

export function Replay({
  run,
  routeId,
  provenance,
}: {
  run: RunResult;
  /**
   * The id this run was OPENED under (the `/runs/[id]` segment). The report
   * off-ramp is built from it, because `/findings/[id]` resolves the same id. It
   * is not `run.runId`: a saved live run is stored under a row id, and the two
   * only coincide for the sample.
   */
  routeId: string;
  /**
   * Where this verdict came from, supplied by the resolver. Optional because a
   * run's provenance is not this component's to invent: when nothing is passed,
   * nothing is claimed.
   */
  provenance?: string | null;
}) {
  const steps = run.trace.steps;
  const total = steps.length;
  const compromiseIndex = steps.findIndex((s) => s.id === run.verdict.stepId);
  const compromiseStepNumber = compromiseIndex >= 0 ? compromiseIndex + 1 : null;
  const offStep = compromiseIndex >= 0 ? steps[compromiseIndex] : null;
  const offendingLabel = offStep && 'tool' in offStep ? offStep.tool : undefined;

  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Bumped on RESET so the verdict terminal's export prompt re-arms (keyed remount).
  const [resetKey, setResetKey] = useState(0);

  const atEnd = current >= total - 1;
  const layout = useReplayLayout();

  useEffect(() => {
    if (!playing || atEnd) return;
    const t = setTimeout(() => setCurrent((c) => Math.min(c + 1, total - 1)), 1100 / speed);
    return () => clearTimeout(t);
  }, [playing, current, atEnd, total, speed]);

  const step = steps[current]!;
  const compromised = current === compromiseIndex;

  const playToggle = () => {
    if (atEnd) {
      setCurrent(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  };
  const stepBy = (d: number) => {
    setPlaying(false);
    setCurrent((c) => Math.max(0, Math.min(total - 1, c + d)));
  };
  const scrubTo = (i: number) => {
    setPlaying(false);
    setCurrent(Math.max(0, Math.min(total - 1, i)));
  };
  const restart = () => {
    setPlaying(false);
    setCurrent(0);
    setResetKey((k) => k + 1);
  };

  const transport = (placement: 'phone' | 'wide', className: string) => (
    <Transport
      placement={placement}
      className={className}
      current={current}
      total={total}
      playing={playing && !atEnd}
      speed={speed}
      speeds={SPEEDS}
      onPlayToggle={playToggle}
      onStep={stepBy}
      onScrub={scrubTo}
      onRestart={restart}
      onSpeedSet={setSpeed}
    />
  );

  // One sentence for the whole run. A clean verdict is a RESULT, not an absence:
  // the agent was served the run and did not act on it.
  const outcomeLabel = run.verdict.compromised
    ? compromiseStepNumber === null
      ? 'COMPROMISED'
      : `COMPROMISED AT STEP ${compromiseStepNumber}`
    : 'AGENT RESISTED';

  return (
    <div className="flex min-h-[calc(100dvh-var(--header-h))] flex-col">
      {/* Header — kicker + title + the run's outcome and provenance.
          THE OUTCOME IS STATED UP FRONT, both ways round. A compromise names the
          step it is anchored to; a run the agent resisted says so in the nominal
          state, because resisting is the product working, not a missing result.
          The step number is EVIDENCE quoted from the trace, so it is printed,
          never counted up. */}
      <header className="border-b border-line px-6 py-5 lg:px-8">
        <p className="micro-label text-nominal">Live Attack Replay</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="reading-h2 font-semibold text-ink-hi">
            {/* The class this run staged, with its official name from the one
                lookup. It printed a table of its own before, which had drifted
                from the board's spelling. */}
            <AsiLabel code={run.category} separator=" · " />
          </h1>
          <span data-testid="run-outcome" className="shrink-0">
            <StatusChip
              state={run.verdict.compromised ? 'breach' : 'nominal'}
              label={outcomeLabel}
            />
          </span>
        </div>
        {provenance ? (
          <p className="instrument mt-(--instrument-stack) text-ink-faint">{provenance}</p>
        ) : null}
      </header>

      {/* Stage — two terminals in a row, then a full-width transport and the
          step-detail box directly beneath both (no dead gap). */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* On a phone: terminal and transport in one box no taller than the
              viewport under the header. From 768px up this box is not drawn
              (display: contents) and the terminal is the grid cell it was. */}
          <div className="contents phone:flex phone:max-h-[calc(100dvh-var(--header-h)-1rem)] phone:min-h-0 phone:flex-col phone:gap-4">
            <ReplayTerminal
              steps={steps}
              current={current}
              compromiseIndex={compromiseIndex}
              model={run.model}
              onSelect={scrubTo}
            />
            {layout !== 'wide' && transport('phone', 'hidden phone:flex phone:shrink-0')}
          </div>
          <VerdictRail
            key={resetKey}
            verdict={run.verdict}
            routeId={routeId}
            compromiseStepNumber={compromiseStepNumber}
            offendingLabel={offendingLabel}
          />
        </div>

        {layout !== 'phone' && transport('wide', 'phone:hidden')}

        <StepDetail step={step} index={current} compromised={compromised} />

        <ReplayKey id={REPLAY_KEY_ID} entries={transcriptKeyEntries()} />
      </div>
    </div>
  );
}
