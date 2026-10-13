import { REPO_URL } from '@/config/repo';
import { Metric } from '@/components/hud/Metric';
import { OwaspBadge, OwaspExplainer } from '@/components/hud/OwaspTopTen';
import { Core7List } from '@/components/home/Core7List';
import { HeroReplay } from '@/components/home/HeroReplay';
import { HomeCtas } from '@/components/home/HomeCtas';
import { HowATestWorks } from '@/components/home/HowATestWorks';
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
import { describeLiveRunAllowanceNote } from '@/runs/allowance';
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
 *
 * ONE COMPONENT DRAWS ALL THREE FIGURES, AT ONE SIZE (UI audit 2026-10-12,
 * batch D): `Metric`, a label, the value and a plain sentence saying what the
 * value measures. The classification figure used to be a size smaller, to mark
 * it as the lesser claim; a reader took the smaller number for a footnote. What
 * keeps the two measurements apart now is what always did the real work: two
 * groups, two names, two provenance lines, and a label that says "category
 * classification accuracy" and never plain "accuracy".
 */

/**
 * The full v1 results writeup. It lives at the repo root, so the link is the
 * canonical GitHub blob URL rather than an app route: the finding and the
 * figures on screen are a summary, and what they lean on (subject model,
 * per-run trace ids, both measurements with their provenance, how to
 * reproduce) lives there. The app has no results page of its own, and none is
 * invented here.
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
  // How many free live runs an account gets, as a sentence, read here on the
  // server. Nothing when no count is configured, and then no note is drawn.
  const freeRunsNote = describeLiveRunAllowanceNote();

  return (
    <div className="flex min-h-[calc(100dvh-62px)] items-start lg:items-center">
      <div className="mx-auto w-full max-w-[1400px] px-6 py-8">
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1.3fr_0.8fr] lg:gap-10">
          {/* ── left: pitch + stat + CTAs + trailer ── */}
          <section aria-labelledby="home-title" className="flex min-w-0 flex-col gap-4">
            <h1 id="home-title" className="reading-h1 max-w-[22ch]">
              Red-team your MCP agent. Trust the verdict either way.
            </h1>

            {/* WHAT THE PRODUCT DOES, in one plain sentence (UI audit 2026-10-12,
                batch C). It replaces the lead that described the mechanism
                (an endpoint we host, the tool calls we record): the mechanism
                is what Connect is for, and a first-time reader needs to know
                what this is before how it works. It promises nothing about
                the reader's own agent: "whether" and "if one is" keep both
                results open, as framing.test.tsx requires. No number, so
                nothing in it can drift from a measurement. */}
            <p data-testid="home-subhead" className="reading-lead measure">
              MCProof tests whether an AI agent can be tricked into misusing its tools, and if one
              is, shows the exact step where it happened.
            </p>

            {/* WHAT IT MAPS TO, and what that phrase means. The badge is text
                only and links to the coverage board, where the claim is exact:
                which of the ten are tested and which are not. The explanation
                beside it is a native disclosure, closed until asked for, so it
                takes one line here and moves nothing above it when it opens. */}
            <div className="flex flex-wrap items-start gap-x-4">
              <OwaspBadge />
              <OwaspExplainer className="flex-1 basis-[17rem]" />
            </div>

            <p className="reading measure">
              Most tools only <span className="text-ink-muted">guess</span> whether an agent was
              compromised. We tested our detector against attacks with known outcomes and{' '}
              <span className="font-semibold text-nominal">measured</span> how accurate it is, so
              you can trust its verdicts.
            </p>

            {/* No measured live finding is shown here (V1, 2026-10-14). The ASI02
                "5 of 10 / 6 of 10" finding that sat here came from a live trap that
                served its fabricated credential on the task's own first read, so it
                measured the trap, not the agent. It returns only once the fixed trap
                is re-measured. */}

            {/* THE COMPROMISE CALL — "was this run compromised", scored over every labeled
                realization. Labelled for the QUESTION, never "detector accuracy": one
                heading over this and the classification figure below is exactly how two
                measurements with different denominators become one number, and the weaker
                of the two then hides behind the stronger.

                Provenance leads; the numbers render at their FINAL value immediately (SSR +
                client), NEVER counting up: this claim is the evidence of the core promise,
                so a transient "0.00 precision" would assert the opposite.

                Each figure is drawn by Metric, with a sentence saying what it
                measures: "precision" and "recall" are words a first-time reader
                has to look up, and which of the two is which is the whole
                meaning of the pair. */}
            {/* ONE CARD AROUND BOTH MEASUREMENTS (UI audit 2026-10-13, batch F):
                the raised surface and `--elev-1`, asked for by `data-elev`. One
                card and not one for each group, so there is one shadow, and the
                two groups inside it are still two: each keeps its own name and
                provenance line, and a rule is drawn between them. */}
            <div
              data-elev="1"
              data-metric-card=""
              className="flex flex-col gap-4 rounded-lg border border-line p-4"
            >
              <div
                role="group"
                aria-labelledby="metric-compromise-label"
                data-metric-group="compromise"
              >
                <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-(--instrument-stack-rows)">
                  <span id="metric-compromise-label" className="micro-label text-nominal">
                    Compromise detection
                  </span>
                  <span data-metric-provenance="" className="instrument-faint">
                    {MEASURED_COMPROMISE_PROVENANCE}
                  </span>
                </div>
                <dl className="flex flex-col gap-3">
                  <Metric
                    id="precision"
                    label="Precision"
                    value={MEASURED_COMPROMISE.precision.toFixed(2)}
                    meaning="Of the runs the detector flagged as compromised, the share that really were."
                  />
                  <Metric
                    id="recall"
                    label="Recall"
                    value={MEASURED_COMPROMISE.recall.toFixed(2)}
                    meaning="Of the runs that really were compromised, the share the detector flagged."
                  />
                </dl>
              </div>

              {/* A SECOND measurement, deliberately in its own labelled group. It answers a
                different question over a different denominator, so it must not sit in the
                group above as if it were a third view of one number. Its own name, its own
                provenance line (which quotes its own denominator, n=22 scored), and a label
                that says what kind of accuracy it is. The same component at the same size
                as the two above: what separates them is the group, not the type size. */}
              <div
                role="group"
                aria-labelledby="metric-classification-label"
                data-metric-group="classification"
                className="border-t border-line/60 pt-3"
              >
                <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-(--instrument-stack-rows)">
                  <span id="metric-classification-label" className="micro-label">
                    Category classification
                  </span>
                  <span data-metric-provenance="" className="instrument-faint">
                    {MEASURED_CLASSIFICATION_PROVENANCE}
                  </span>
                </div>
                <dl className="flex flex-col gap-3">
                  <Metric
                    id="classification-accuracy"
                    label="Category classification accuracy"
                    value={MEASURED_CLASSIFICATION.accuracy.toFixed(2)}
                    meaning="Of the real compromises the detector caught, the share it filed under the right category."
                  />
                </dl>
              </div>
            </div>

            {/* THE CONDITION BOTH FIGURES CARRY. Stated once, in prose, because a
                measured number with no stated condition reads as a property of the
                product rather than of one pinned judge. It names no model and no
                temperature: the provenance lines above already carry the judge, and
                re-typing a config value here would give it a second place to drift. */}
            <p className="reading measure text-ink-muted">
              Both figures hold only for the frozen judge named in their provenance lines. Change
              the rubric, the model or the temperature and they are void until re-measured.
            </p>

            {/* THE FULL RESULTS, on a line of their own under the figures (UI audit
                2026-10-12, batch D). It was a small mono line under the finding, with
                no underline until hovered. It is a block now, so nothing shares its
                line; underlined, so it is a link by more than its colour; and at least
                `--target-min` tall. The words on screen start its name, and the rest
                of the name, kept for a screen reader, says results of what and where
                the link goes: read out of context, "Read full results" alone says
                neither. It leaves the app, so it opens beside it. */}
            <a
              href={RESULTS_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-results-link=""
              className="flex min-h-(--target-min) w-fit items-center gap-2 font-mono text-[14px] tracking-[0.06em] text-nominal underline underline-offset-4 transition-colors hover:text-readout"
            >
              Read full results
              <span className="sr-only">: the measured results writeup, on GitHub</span>
              <span aria-hidden="true">→</span>
            </a>

            {/* BOTH OUTCOMES, NAMED ONCE, NEITHER MARKED AS EXPECTED. The full paragraph
                that used to carry this was low-contrast and sat between the finding and
                the numbers; this states the same two-results honesty in one line so the
                finding leads. framing.test.tsx holds that both outcomes stay named. */}
            <p className="reading measure">
              Every run resolves one of two ways: a compromise becomes a fix report anchored to the
              offending step, and a clean run lands on the robustness leaderboard. Which one is
              measured, not predicted.
            </p>

            {/* The two calls to action, the featured run's name, and the free-runs
                note when a count is configured (HomeCtas). */}
            <HomeCtas category={sample.category} freeRunsNote={freeRunsNote} />

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

            {/* HOW A TEST WORKS, under the replay it explains (Batch G). In this
                column, so it is beside the pitch from 1024px and after it on a
                phone: either way it is not above the two calls to action and
                moves neither of them. */}
            <HowATestWorks />

            <Core7List runHref={runHref} />
          </div>
        </div>
      </div>
    </div>
  );
}
