'use client';

import { useEffect, useRef, useState } from 'react';
import type { RunResult } from '@/contract';
import { AsiLabel, Button, StatusChip } from '@/components/hud';
import { cn } from '@/lib/utils';
import { RunProvenance } from '@/components/hud/RunProvenance';
import { ReplayTerminal } from './ReplayTerminal';
import { Transport } from './Transport';
import { StepDetail } from './StepDetail';
import { VerdictRail } from './VerdictRail';
import { REPLAY_KEY_ID } from './ReplayKey';
import { ReplayLegend } from './ReplayLegend';
import { SpeakerDefinitions } from './SpeakerHandle';
import { useReplayLayout } from './phone-layout';
import { SCORING_EXCLUSION_LABEL, type ScoringExclusion } from '@/leaderboard/scoring-rules';

/**
 * Replay (the hero) — two terminals over a full-width transport. The
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
 * THE LEGEND (Batch G, 2026-10-13) is directly ABOVE the terminal, at every
 * width: who each prompt is, then the colour key (`ReplayLegend`). The key was
 * the last thing on the stage, under the step detail, a screen away from the
 * transcript it explains; it is the same component, moved, and the
 * transcript's list still points at it with `aria-describedby`. At every width
 * it is a "Key" disclosure, closed when the page opens (owner ruling,
 * 2026-10-14), so Play stays above the fold at 1280 by 720. Like the transport, the server sends
 * both and CSS shows the one that fits; once the browser has answered only
 * that one is kept, and the id the list points at is on one of them at a time.
 * It is static text and not a live region; the step detail stays the one live
 * region here.
 *
 * EACH PROMPT OPENS ITS DEFINITION (`SpeakerHandle`), one at a time across the
 * transcript and the verdict rail, which is why both sit inside one
 * `SpeakerDefinitions`.
 *
 * THE VERDICT IS REVEALED, NOT SHOWN AT LOAD (owner ruling 2026-10-17). The
 * detector reads the whole trace after the run, so while the replay plays it
 * shows no verdict: the rail waits, the title has no badge, no step is marked
 * and the header's run chip is held invisible. It is revealed when the playhead
 * reaches the last step (played, stepped or scrubbed to), or at once by "Show
 * verdict now", which stands where the badge will be and so is the first thing
 * in the replay's focus order. Once revealed it stays revealed until RESET.
 * The reveal is announced in a polite live region that is there, empty, from
 * the start. The fix report is not a replay and shows its verdict at once.
 *
 * THE HEADER'S RUN CHIP (BREACH or CLEAR, the category and the severity) is
 * drawn by the server-rendered shell, not here. While the verdict waits, the
 * replay's root carries `data-verdict-pending`, and one rule in globals.css
 * holds that chip invisible in its place while such a root is on the page, so
 * the header does not move when it appears. It holds before hydration too.
 */
const SPEEDS = [0.5, 1, 2, 4];

interface ReplayProps {
  run: RunResult;
  /**
   * The id this run was OPENED under (the `/runs/[id]` segment). The report
   * off-ramp is built from it, because `/findings/[id]` resolves the same id,
   * and it is the ONE run id this screen prints (owner ruling 2026-10-15). It
   * is not `run.runId`: a saved live run is stored under a row id
   * (`StoredRun.id`), while `run.runId` is the hosted MCP run's id, and a page
   * that printed both read as two runs.
   */
  routeId: string;
  /**
   * Where this verdict came from, supplied by the resolver. Optional because a
   * run's provenance is not this component's to invent: when nothing is passed,
   * nothing is claimed.
   */
  provenance?: string | null;
  /**
   * When a live run ran (ISO), so its day is drawn in the viewer's own time
   * zone (owner ruling 2026-10-15). Absent for a sample.
   */
  runAt?: string | null;
  /**
   * Why the leaderboard does not score this run, if it does not (owner ruling
   * 2026-10-18). Said once under the provenance line. It is not part of the
   * verdict, so it is shown from the start.
   */
  scoringExclusion?: ScoringExclusion | null;
}

/** One replay, and the one place that holds which prompt's definition is open. */
export function Replay(props: ReplayProps) {
  return (
    <SpeakerDefinitions>
      <ReplayStage {...props} />
    </SpeakerDefinitions>
  );
}

function ReplayStage({ run, routeId, provenance, runAt, scoringExclusion }: ReplayProps) {
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
  // Latched once the verdict has been shown; only RESET clears it.
  const [shown, setShown] = useState(false);
  const outcomeRef = useRef<HTMLSpanElement>(null);
  const focusOutcome = useRef(false);

  const atEnd = current >= total - 1;
  const revealed = shown || atEnd;

  // Move the playhead. Reaching the last step reveals the verdict, and it
  // stays revealed after that (latched here, where the playhead moves).
  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(total - 1, i));
    setCurrent(next);
    if (next >= total - 1) setShown(true);
  };

  // "Show verdict now" is gone once pressed, so focus goes to the outcome it
  // revealed rather than falling back to the page.
  useEffect(() => {
    if (revealed && focusOutcome.current) {
      focusOutcome.current = false;
      outcomeRef.current?.focus({ preventScroll: true });
    }
  }, [revealed]);
  const layout = useReplayLayout();

  useEffect(() => {
    if (!playing || atEnd) return;
    const t = setTimeout(() => {
      const next = Math.min(current + 1, total - 1);
      setCurrent(next);
      if (next >= total - 1) setShown(true);
    }, 1100 / speed);
    return () => clearTimeout(t);
  }, [playing, current, atEnd, total, speed]);

  const step = steps[current]!;
  const compromised = revealed && current === compromiseIndex;

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
    goTo(current + d);
  };
  const scrubTo = (i: number) => {
    setPlaying(false);
    goTo(i);
  };
  const restart = () => {
    setPlaying(false);
    setCurrent(0);
    setShown(false);
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
  // What the live region says when the verdict is revealed. No em dash.
  const announcement = run.verdict.compromised
    ? compromiseStepNumber === null
      ? 'Verdict: compromised.'
      : `Verdict: compromised at step ${compromiseStepNumber}.`
    : 'Verdict: agent resisted.';
  const showNow = () => {
    focusOutcome.current = true;
    setShown(true);
  };

  return (
    <div
      data-verdict-pending={revealed ? undefined : ''}
      className="flex min-h-[calc(100dvh-var(--header-h))] flex-col"
    >
      {/* Header — kicker + title + the run's outcome and provenance.
          THE OUTCOME IS STATED UP FRONT, both ways round. A compromise names the
          step it is anchored to; a run the agent resisted says so in the nominal
          state, because resisting is the product working, not a missing result.
          The step number is EVIDENCE quoted from the trace, so it is printed,
          never counted up. */}
      <header className="border-b border-line px-6 py-5 lg:px-8">
        <p className="micro-label text-nominal">Replay</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="reading-h2 font-semibold text-ink-hi">
            {/* The class this run staged, with its official name from the one
                lookup. It printed a table of its own before, which had drifted
                from the board's spelling. */}
            <AsiLabel code={run.category} separator=" · " />
          </h1>
          {/* ONE SLOT FOR BOTH, so the reveal moves nothing. The button and the
              badge share a grid cell, sized by the larger of the two, and the
              one not on show is `invisible` (out of the tab order and the
              accessibility tree, its box kept). Swapping one for the other
              changed the title row's height, and everything under it moved. */}
          <span className="inline-grid shrink-0 items-center">
            <span
              ref={outcomeRef}
              tabIndex={revealed ? -1 : undefined}
              data-testid={revealed ? 'run-outcome' : undefined}
              aria-hidden={revealed ? undefined : true}
              className={cn('[grid-area:1/1]', !revealed && 'invisible')}
            >
              <StatusChip
                state={revealed && run.verdict.compromised ? 'breach' : 'nominal'}
                label={revealed ? outcomeLabel : outcomeLabel.replace(/\S/g, ' ')}
              />
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-hidden={revealed ? true : undefined}
              tabIndex={revealed ? -1 : undefined}
              className={cn('target-min [grid-area:1/1]', revealed && 'invisible')}
              onClick={showNow}
            >
              Show verdict now
            </Button>
          </span>
        </div>
        {/* The reveal, said once to a screen reader. There, empty, from the
            start, so the words are announced when they arrive. */}
        <p data-testid="verdict-announcement" aria-live="polite" className="sr-only">
          {revealed ? announcement : ''}
        </p>
        {/* The run telemetry, under the title (G option B, owner ruling
            2026-10-14). It used to be cut to one line in the header bar; here
            it wraps, so a long run id or model name is printed in full. The
            run id is the one in the URL, never the hosted run id on the
            verdict (owner ruling 2026-10-15): one run, one id. "BLIND TO THE
            ATTACK" says what blind means: the detector is never told which
            attack the run staged. */}
        <p
          data-replay-telemetry=""
          className="instrument mt-(--instrument-stack) text-ink-muted [overflow-wrap:anywhere]"
        >
          RUN <span className="text-readout">{routeId}</span>
          <span aria-hidden="true"> · </span>AGENT <span className="text-readout">{run.model}</span>
          <span aria-hidden="true"> · </span>DETECTOR{' '}
          <span className="text-nominal">BLIND TO THE ATTACK</span>
        </p>
        {provenance ? (
          <p className="instrument mt-(--instrument-stack) text-ink-faint">
            <RunProvenance text={provenance} runAt={runAt} />
          </p>
        ) : null}
        {scoringExclusion ? (
          <p
            data-scoring-exclusion={scoringExclusion}
            className="instrument mt-(--instrument-stack-rows) text-ink-muted"
          >
            {SCORING_EXCLUSION_LABEL[scoringExclusion]}
          </p>
        ) : null}
      </header>

      {/* Stage — two terminals in a row, then a full-width transport and the
          step-detail box directly beneath both (no dead gap). */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* The legend, above both terminals. On a phone the closed "Key" is
              pulled up into the stage's own top padding (`-mt-6` against
              `py-6`), and the terminal gives up the rest of its height, so
              Play is where it was. */}
          {layout !== 'phone' && (
            <ReplayLegend
              placement="wide"
              model={run.model}
              keyId={REPLAY_KEY_ID}
              className="phone:hidden lg:col-span-2"
            />
          )}
          {layout !== 'wide' && (
            <ReplayLegend
              placement="phone"
              model={run.model}
              keyId={layout === 'phone' ? REPLAY_KEY_ID : undefined}
              className="hidden phone:-mt-6 phone:block"
            />
          )}
          {/* On a phone: terminal and transport in one box no taller than the
              viewport under the header. From 768px up this box is not drawn
              (display: contents) and the terminal is the grid cell it was. */}
          {/* `--scroll-cap-less` is inherited by the terminal: its 45% cap gives
              back what the closed "Key" above adds, so Play does not move. */}
          <div className="contents phone:flex phone:max-h-[calc(100dvh-var(--header-h)-1rem)] phone:min-h-0 phone:flex-col phone:gap-4 phone:[--scroll-cap-less:var(--replay-key-closed)]">
            <ReplayTerminal
              steps={steps}
              current={current}
              compromiseIndex={revealed ? compromiseIndex : -1}
              model={run.model}
              onSelect={scrubTo}
            />
            {layout !== 'wide' && transport('phone', 'hidden phone:flex phone:shrink-0')}
          </div>
          <VerdictRail
            key={resetKey}
            verdict={run.verdict}
            revealed={revealed}
            routeId={routeId}
            compromiseStepNumber={compromiseStepNumber}
            offendingLabel={offendingLabel}
          />
        </div>

        {layout !== 'phone' && transport('wide', 'phone:hidden')}

        <StepDetail step={step} index={current} compromised={compromised} />
      </div>
    </div>
  );
}
