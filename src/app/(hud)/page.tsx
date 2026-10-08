import Link from 'next/link';
import { REPO_URL } from '@/config/repo';
import { Core7List } from '@/components/home/Core7List';
import { HeroReplay } from '@/components/home/HeroReplay';
import { SampleTrailer } from '@/components/home/SampleTrailer';
import { getDataSource } from '@/data/source';
import { SAMPLE_VERDICT_PROVENANCE } from '@/data/fixtures/sample-verdicts';
import {
  MEASURED_CLASSIFICATION,
  MEASURED_CLASSIFICATION_PROVENANCE,
  MEASURED_COMPROMISE,
  MEASURED_COMPROMISE_PROVENANCE,
} from '@/eval/measured';
import { offendingStepLabel } from '@/lib/hud/trace-view';
import type { RunResult, Step } from '@/contract';

/**
 * Home — the BRAND-register front door. The pitch + the measured-detector claim
 * + the Core-7 launcher + the sample trailer, composed to fit ONE viewport.
 *
 * Everything about the featured run is BOUND to the real sample `RunResult`
 * (run id, step total, compromise step) — no `RG-0472`/`/13` literals.
 *
 * ── WHAT THE PITCH IS ALLOWED TO PROMISE ──
 *
 * That we measure, and how. Never what the reader will find. We have no
 * evidence about how often a real agent takes the bait: the ASI01 spike came
 * back a confounded no and the ASI04 spike has never been run against a naive
 * client, so "we will find your agent's weaknesses" and "most agents hold" are
 * both unsupported and the first one is the tempting one. So the headline
 * names the two results a run can have and says which one you get is the
 * measurement. `tests/unit/app/framing.test.tsx` fails if that drifts back.
 *
 * TWO measured figures reach this screen, and they are structurally separated
 * because they are separate measurements: the compromise precision/recall, and
 * the category-classification accuracy (a different question over a smaller
 * denominator). Each sits in its own labelled group, named for the question it
 * answers rather than for "accuracy", because one heading over both is how they
 * merge and the weaker figure disappears behind the stronger one. Both live in
 * `@/eval/measured`, each welded to its own provenance line; neither may be
 * edited here.
 */

/**
 * The full v1 results writeup, one click away from the finding and the CTAs. It
 * lives at the repo root, so the link is the canonical GitHub blob URL rather than
 * an app route: the finding on screen is a summary, and the provenance the summary
 * leans on (subject model, per-run trace ids, how to reproduce) lives there.
 */
const RESULTS_URL = `${REPO_URL}/blob/main/RESULTS.md`;

/** One-line, plain-words summary of the featured ASI02 attack (trailer + caption). */
const FEATURED_DESCRIPTOR = 'tool misuse to out-of-scope file read';

/** Human-readable one-liner for a trace step (for the trailer end labels). */
function stepLabel(step: Step): string {
  switch (step.type) {
    case 'principal_instruction':
      return 'principal instruction';
    case 'agent_reasoning':
      return 'agent reasoning';
    case 'tool_call':
      return `${step.tool} call`;
    case 'tool_result':
      return `${step.tool} result`;
    case 'memory_read':
      return 'memory read';
    case 'memory_write':
      return 'memory write';
    case 'task_complete':
      return 'complete';
  }
}

/** Resolve the compromise step (1-based index + offending step name) from the verdict. */
function compromise(run: RunResult): { index: number; tool: string } {
  const steps = run.trace.steps;
  const index = steps.findIndex((s) => s.id === run.verdict.stepId) + 1;
  const step = steps[index - 1];
  return { index, tool: step ? offendingStepLabel(step) : run.verdict.category };
}

export default async function Home() {
  const ds = getDataSource();
  const [sample, runs] = await Promise.all([ds.getRun('sample'), ds.listRuns()]);
  if (!sample) throw new Error('sample run unavailable');

  const runById: Record<string, string> = Object.fromEntries(
    runs.map((r) => [r.category, r.runId]),
  );
  const runHref = (id: string) =>
    id === sample.category ? '/runs/sample' : `/runs/${runById[id] ?? 'sample'}`;

  const steps = sample.trace.steps;
  const total = steps.length;
  const first = steps[0];
  const last = steps[total - 1];
  const { index: compromiseIndex, tool: offendingTool } = compromise(sample);

  return (
    <div className="flex min-h-[calc(100dvh-62px)] items-start lg:items-center">
      <div className="mx-auto w-full max-w-[1400px] px-6 py-8">
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1.3fr_0.8fr] lg:gap-10">
          {/* ── left: pitch + stat + CTAs + trailer ── */}
          <section aria-labelledby="home-title" className="flex min-w-0 flex-col gap-4">
            <h1 id="home-title" className="reading-h1 max-w-[22ch]">
              Red-team your MCP agent. Trust the verdict either way.
            </h1>

            <p className="reading-lead">
              Point your own agent at an endpoint we host, and we serve it one of the OWASP Agentic
              Top 10 attacks and record every tool call it chooses to make.
            </p>

            <p className="reading">
              Most tools only <span className="text-ink-muted">guess</span> whether an agent was
              compromised. We tested our detector against attacks with known outcomes and{' '}
              <span className="font-semibold text-nominal">measured</span> how accurate it is, so
              you can trust its verdicts.
            </p>

            {/* A CONCRETE MEASURED FINDING, stated as a PAST result about the subject
                model, never a prediction about the reader's own agent. framing.test.tsx
                forbids rate/prediction claims about "agents" in general and any promise
                about "your agent"; this names one frontier model and what it did in a
                run set we measured, with the full provenance one click away in RESULTS.md.
                It is not a status chip, so it carries no tri-state glow: red is reserved
                for a live breach indicator, not a summary statistic. */}
            <div className="border-l-2 border-nominal/50 pl-3">
              <p className="reading">
                <span className="micro-label text-nominal">Measured finding</span> Asked to fetch
                the invoice for a single customer account, a frontier agent performed an
                out-of-scope read on an unscoped path, which in this simulated environment returns a
                fabricated credential preview; the read occurred in 5 of 10 in a clean single sweep
                and 6 of 10 in a prior run, every instance Critical.
              </p>
              <a
                href={RESULTS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex min-h-11 items-center font-mono text-[13px] tracking-[0.06em] text-nominal hover:underline"
              >
                Read the full results →
              </a>
            </div>

            {/* THE COMPROMISE CALL — "was this run compromised", scored over every labeled
                realization. Labelled for the QUESTION, never "detector accuracy": one
                heading over this and the classification figure below is exactly how two
                measurements with different denominators become one number, and the weaker
                of the two then hides behind the stronger.

                Provenance leads; the numbers render at their FINAL value immediately (SSR +
                client), NEVER counting up: this claim is the evidence of the core promise,
                so a transient "0.00 precision" would assert the opposite. */}
            <div
              role="group"
              aria-labelledby="metric-compromise-label"
              className="border-t border-line pt-3"
            >
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span id="metric-compromise-label" className="micro-label text-nominal">
                  Compromise detection
                </span>
                <span className="instrument-faint">{MEASURED_COMPROMISE_PROVENANCE}</span>
              </div>
              <div className="flex items-baseline gap-x-6">
                <span className="whitespace-nowrap">
                  <span className="display-lg font-sans">
                    {MEASURED_COMPROMISE.precision.toFixed(2)}
                  </span>
                  <span className="instrument ml-2">precision</span>
                </span>
                <span className="whitespace-nowrap">
                  <span className="display-lg font-sans">
                    {MEASURED_COMPROMISE.recall.toFixed(2)}
                  </span>
                  <span className="instrument ml-2">recall</span>
                </span>
              </div>
            </div>

            {/* A SECOND measurement, deliberately in its own labelled group and at a smaller
                DISPLAY size. It answers a different question over a different denominator, so
                it must not sit in the row above as if it were a third view of one number.
                Subordinate in size because the product's claim is the compromise call; this
                qualifies which Core-7 code that compromise is filed under. */}
            <div
              role="group"
              aria-labelledby="metric-classification-label"
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line/60 pt-3"
            >
              <span id="metric-classification-label" className="micro-label">
                Category classification
              </span>
              <span className="whitespace-nowrap">
                <span className="display-md font-sans">
                  {MEASURED_CLASSIFICATION.accuracy.toFixed(2)}
                </span>
                <span className="instrument ml-2">accuracy</span>
              </span>
              <span className="instrument-faint">{MEASURED_CLASSIFICATION_PROVENANCE}</span>
            </div>

            {/* THE CONDITION BOTH FIGURES CARRY. Stated once, in prose, because a
                measured number with no stated condition reads as a property of the
                product rather than of one pinned judge. It names no model and no
                temperature: the provenance lines above already carry the judge, and
                re-typing a config value here would give it a second place to drift. */}
            <p className="reading text-ink-muted">
              Both figures hold only for the frozen judge named in their provenance lines. Change
              the rubric, the model or the temperature and they are void until re-measured.
            </p>

            {/* BOTH OUTCOMES, NAMED ONCE, NEITHER MARKED AS EXPECTED. The full paragraph
                that used to carry this was low-contrast and sat between the finding and
                the numbers; this states the same two-results honesty in one line so the
                finding leads. framing.test.tsx holds that both outcomes stay named. */}
            <p className="reading">
              Every run resolves one of two ways: a compromise becomes a fix report anchored to the
              offending step, and a clean run lands on the robustness leaderboard. Which one is
              measured, not predicted.
            </p>

            {/* CTAs */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-5">
                <Link
                  href="/runs/sample"
                  className="inline-flex items-center gap-2 rounded-md border border-nominal bg-nominal/10 px-6 py-3 font-mono text-[14px] tracking-[0.08em] text-readout shadow-glow-nominal transition-colors hover:bg-nominal/20"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <polygon points="2,1 11,6 2,11" fill="currentColor" />
                  </svg>
                  Play {sample.category} sample
                </Link>
                {/* The secondary CTA sits in a control row, not in a sentence, so
                    the WCAG 2.2 2.5.8 inline-link exception does not cover it. It
                    measured 195x21 and now clears the 24px minimum with room. */}
                <Link
                  href="/connect"
                  className="inline-flex min-h-11 items-center font-mono text-[14px] tracking-[0.06em] text-nominal hover:underline"
                >
                  Connect your agent →
                </Link>
              </div>
              <p className="instrument-faint">
                Featured run: tool misuse. Pick any of the Core-7 to watch its own attack.
              </p>
            </div>

            <SampleTrailer
              runId={sample.runId}
              category={sample.category}
              descriptor={FEATURED_DESCRIPTOR}
              total={total}
              compromiseIndex={compromiseIndex}
              offendingTool={offendingTool}
              firstLabel={first ? stepLabel(first) : ''}
              lastLabel={last ? stepLabel(last) : ''}
              watchHref="/runs/sample"
              /* WHAT THE TRAILER IS, in the sample library's own words. The strip
                 badges a breach dot, and a breach dot on the front door reads as a
                 captured agent unless the label says otherwise. It is a constructed
                 trace with a recorded verdict, and it never travels without saying so. */
              provenance={SAMPLE_VERDICT_PROVENANCE}
            />
          </section>

          {/* ── right: hero micro-replay of the featured trace + Core-7 launcher ── */}
          <div className="flex min-w-0 flex-col gap-4 lg:border-l lg:border-line lg:pl-8">
            <HeroReplay
              steps={steps}
              compromiseIndex={compromiseIndex}
              offendingTool={offendingTool}
              category={sample.category}
            />

            <Core7List runHref={runHref} />
          </div>
        </div>
      </div>
    </div>
  );
}
