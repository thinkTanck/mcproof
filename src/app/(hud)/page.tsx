import { REPO_URL } from '@/config/repo';
import { Metric } from '@/components/hud/Metric';
import { OwaspBadge, OwaspExplainer } from '@/components/hud/OwaspTopTen';
import { Core7List } from '@/components/home/Core7List';
import { HeroReplay } from '@/components/home/HeroReplay';
import { HomeCtas } from '@/components/home/HomeCtas';
import { HowATestWorks } from '@/components/home/HowATestWorks';
import { SampleTrailer } from '@/components/home/SampleTrailer';
import { getDataSource } from '@/data/source';
import { sampleDisplayProvenance } from '@/lib/display/dates';
import { MEASURED_CLASSIFICATION, MEASURED_COMPROMISE } from '@/eval/measured';
import {
  classificationDisplayProvenance,
  compromiseDisplayProvenance,
  measuredCopy,
} from '@/lib/display/measured';
import { offendingStepLabel } from '@/lib/hud/trace-view';
import { describeLiveRunAllowanceNote } from '@/runs/allowance';
import type { RunResult, Step } from '@/contract';
import { METRIC_HEADING_CLASSIFICATION, METRIC_HEADING_COMPROMISE } from '@/lib/site-copy';
import { ProvenanceLine } from '@/components/hud/ProvenanceLine';

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
 * groups, two names, two provenance lines, and a figure that is named for the
 * attack type and never called plain "accuracy".
 *
 * COPY PASS 2026-10-15: the words "precision" and "recall" are gone from the
 * screen. Each figure's label is now the count behind it ("22 of 23") and its
 * sentence says what that count is; the values are still the measured rates.
 * Every count and the measurement day are derived in
 * `src/lib/display/measured.ts` from the frozen constants.
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

/**
 * The two group headings of the metric block share ONE class, so they are one
 * colour (owner ruling 2026-10-15): the compromise heading was nominal and the
 * classification heading the label default, which read as a ranking.
 */
const METRIC_GROUP_HEADING = 'micro-label text-nominal';

/** One-line, plain-words summary of the featured ASI02 attack (trailer + caption). */
const FEATURED_DESCRIPTOR = 'tool misuse: reading a file outside the task';

/** Human-readable one-liner for a trace step (for the trailer end labels). */
function stepLabel(step: Step): string {
  switch (step.type) {
    case 'principal_instruction':
      return "operator's task";
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
  // The metric block's words, every count derived from the frozen measurement.
  const copy = measuredCopy();

  return (
    <div className="flex min-h-[calc(100dvh-62px)] items-start lg:items-center">
      <div className="mx-auto w-full max-w-[1400px] px-6 py-8">
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1.3fr_0.8fr] lg:gap-10">
          {/* ── left: pitch + stat + CTAs + trailer ── */}
          <section aria-labelledby="home-title" className="flex min-w-0 flex-col gap-4">
            {/* WHAT THE PRODUCT IS, as a label over the headline (owner ruling
                2026-10-15, Home hero). A label, so INSTRUMENT; it is not a
                heading and does not name the region. */}
            <p className={METRIC_GROUP_HEADING}>
              Red-team testing for AI agents that use MCP tools
            </p>

            <h1 id="home-title" className="reading-h1 max-w-[22ch]">
              Test your AI agent against known attacks.
            </h1>

            {/* WHAT THE PRODUCT DOES, in plain words (owner rulings 2026-10-15
                and 2026-10-16). It promises nothing about the reader's own
                agent: "fooled, or that it held this time" keeps both results
                open, as framing.test.tsx requires, and "this time" claims no
                more than the one run. No number, so nothing in it can drift
                from a measurement. */}
            <p data-testid="home-subhead" className="reading-lead measure">
              We hide an attack inside the MCP tools your agent uses, then show you the exact step
              where it was fooled, or that it held this time.
            </p>

            {/* THE TWO TERMS a fresh reader does not know, said once (owner
                ruling 2026-10-16). */}
            <p data-testid="home-terms" className="reading measure">
              MCP (Model Context Protocol) is the standard way AI agents connect to outside tools. A
              run counts as compromised when your agent takes the harmful action the hidden attack
              asked for.
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
              We tested the detector before we published it, so you can see how often it is right.
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
                  <span id="metric-compromise-label" className={METRIC_GROUP_HEADING}>
                    {METRIC_HEADING_COMPROMISE}
                  </span>
                  <span data-metric-provenance="" className="instrument-faint">
                    <ProvenanceLine text={compromiseDisplayProvenance()} detectorOnOwnLine />
                  </span>
                </div>
                {/* HOW THE FIGURES WERE MADE, and how five grades per run became
                    one result (owner ruling 2026-10-15): the most common answer
                    per run. The day carries "(UTC)". */}
                <p className="reading measure mb-3">{copy.intro}</p>
                <dl className="flex flex-col gap-3">
                  <Metric
                    id="precision"
                    label={copy.precisionLabel}
                    value={MEASURED_COMPROMISE.precision.toFixed(2)}
                    meaning={copy.precision}
                  />
                  <Metric
                    id="recall"
                    label={copy.recallLabel}
                    value={MEASURED_COMPROMISE.recall.toFixed(2)}
                    meaning={copy.recall}
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
                  <span id="metric-classification-label" className={METRIC_GROUP_HEADING}>
                    {METRIC_HEADING_CLASSIFICATION}
                  </span>
                  <span data-metric-provenance="" className="instrument-faint">
                    <ProvenanceLine text={classificationDisplayProvenance()} detectorOnOwnLine />
                  </span>
                </div>
                <dl className="flex flex-col gap-3">
                  <Metric
                    id="classification-accuracy"
                    label={copy.classificationLabel}
                    value={MEASURED_CLASSIFICATION.accuracy.toFixed(2)}
                    meaning={copy.classification}
                  />
                </dl>
              </div>
            </div>

            {/* WHAT THE FIGURES ARE NOT: a score for anyone's agent. */}
            <p className="reading measure">
              These numbers test our detector on runs we built, not how well any agent resists
              attacks.
            </p>

            {/* THE CONDITION BOTH FIGURES CARRY. Stated once, in prose, because a
                measured number with no stated condition reads as a property of the
                product rather than of one pinned detector. The model it names is
                read off the frozen provenance line (src/lib/display/measured.ts),
                never typed here, so it has no second place to drift. */}
            <p className="reading measure text-ink-muted">{copy.condition}</p>

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
              Read the full results <span className="sr-only">on GitHub</span>
              <span aria-hidden="true">→</span>
            </a>

            {/* BOTH OUTCOMES, NAMED ONCE, NEITHER MARKED AS EXPECTED. The full paragraph
                that used to carry this was low-contrast and sat between the finding and
                the numbers; this states the same two-results honesty in one line so the
                finding leads. framing.test.tsx holds that both outcomes stay named. */}
            <p className="reading measure">
              Every run ends one of two ways. If the agent was compromised, you get a fix report
              that names the step where it happened. If not, you get a clean result. Both count
              toward your leaderboard. The detector decides which one after the run, by reading what
              the agent actually did.
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
              provenance={sampleDisplayProvenance()}
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
