import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Replay } from '@/components/replay';
import { getDataSource } from '@/data/source';
import { SAMPLE_VERDICTS } from '@/data/fixtures/sample-verdicts';
import type { RunResult } from '@/contract';

/**
 * Live Attack Replay. These assertions exercise the RELIABLE base of the signal-
 * trace lane: the operable step timeline (a real <ol> of typed <button>s), the
 * transport, the fixed-height detail panel, and the verdict that stays SEALED
 * until the playhead reaches the compromise step. Everything binds to the real
 * sample RunResult, never a literal.
 */
/**
 * The id in the `/runs/[id]` URL. Deliberately NOT the run's own id: for a saved
 * live run the two differ (the route carries the stored row id), and the report
 * off-ramp has to follow the route, which is what `/findings/[id]` resolves.
 */
const ROUTE_ID = 'route-row-7777';

async function sampleRun(): Promise<RunResult> {
  const run = await getDataSource().getRun('sample');
  if (!run) throw new Error('sample run missing');
  return run;
}

describe('Replay — binding + timeline', () => {
  it('binds the run id and step total to the real run (never a literal)', async () => {
    const run = await sampleRun();
    render(<Replay run={run} routeId={ROUTE_ID} />);
    // Step total is the real length, and there is one timeline line per step.
    const timeline = screen.getByRole('list', { name: /step timeline/i });
    const nodes = within(timeline).getAllByRole('button');
    expect(nodes).toHaveLength(run.trace.steps.length);
    // The ROUTE id binds the export off-ramp to this run's fix report, never the
    // verdict's own run id (a live session id the findings route cannot resolve).
    const link = screen.getByRole('link', { name: /export fix report/i });
    expect(link).toHaveAttribute('href', `/findings/${ROUTE_ID}`);
    expect(ROUTE_ID).not.toBe(run.verdict.runId);
  });

  it('badges exactly the compromise step from verdict.stepId', async () => {
    const run = await sampleRun();
    render(<Replay run={run} routeId={ROUTE_ID} />);
    const compromiseNodes = screen.getAllByRole('button', { name: /compromise step/i });
    expect(compromiseNodes).toHaveLength(run.verdict.compromised ? 1 : 0);
  });
});

describe('Replay — transport', () => {
  it('exposes play, step, scrub and speed controls', async () => {
    const run = await sampleRun();
    render(<Replay run={run} routeId={ROUTE_ID} />);
    expect(screen.getByRole('button', { name: /^Play$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restart/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous step/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next step/i })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /scrub to step/i })).toBeInTheDocument();
    // Discrete speed buttons (0.5x / 1x / 2x / 4x) in a labelled group.
    expect(screen.getByRole('group', { name: /playback speed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1×' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4×' })).toBeInTheDocument();
  });
});

describe('Replay — header describes the run it shows', () => {
  it('derives the h1 narrative from the run category, never a hardcoded storyline', async () => {
    const run = await sampleRun();
    render(<Replay run={run} routeId={ROUTE_ID} />);
    const heading = screen.getByRole('heading', { level: 1 });
    // The category code leads the title and the narrative is the ASI06 storyline
    // for the sample; a non-ASI06 run must not inherit "memory poisoning".
    expect(heading).toHaveTextContent(run.category);
    if (run.category !== 'ASI06') {
      expect(heading).not.toHaveTextContent(/memory poisoning/i);
    }
  });
});

describe('Replay — fix-report off-ramp', () => {
  it('links to the fix report for this run', async () => {
    const run = await sampleRun();
    render(<Replay run={run} routeId={ROUTE_ID} />);
    // The verdict summary and the export are shown throughout (only the rationale
    // prose is sealed), so the off-ramp is available from the start.
    const link = screen.getByRole('link', { name: /fix report/i });
    expect(link).toHaveAttribute('href', `/findings/${ROUTE_ID}`);
  });
});

describe('Replay — outcome and provenance', () => {
  it('states the compromise and the step number it is anchored to', async () => {
    const run = await sampleRun();
    render(<Replay run={run} routeId={ROUTE_ID} />);
    const outcome = screen.getByTestId('run-outcome');
    expect(outcome).toHaveTextContent(/compromised at step/i);
    const compromiseIndex = run.trace.steps.findIndex((s) => s.id === run.verdict.stepId);
    expect(outcome).toHaveTextContent(String(compromiseIndex + 1));
  });

  it('shows the provenance it is given, so a verdict never travels unlabelled', async () => {
    const run = await sampleRun();
    render(
      <Replay
        run={run}
        routeId={ROUTE_ID}
        provenance="constructed demonstration · recorded verdict"
      />,
    );
    expect(screen.getByText('constructed demonstration · recorded verdict')).toBeInTheDocument();
  });

  /**
   * THE CLEAN-RESISTANCE RESULT IS A FIRST-CLASS OUTCOME. The same replay, the
   * same controls, a different answer: the agent was served the run and did not
   * take the bait.
   */
  it('replays a run the agent resisted as a successful result', async () => {
    const compromisedRun = await sampleRun();
    const run: RunResult = {
      ...compromisedRun,
      verdict: {
        runId: compromisedRun.verdict.runId,
        compromised: false,
        score: 0.03,
        severity: 'None',
        category: compromisedRun.verdict.category,
        rationale: 'The agent did not act on the injected instruction.',
      },
    };
    render(<Replay run={run} routeId={ROUTE_ID} />);

    expect(screen.getByTestId('run-outcome')).toHaveTextContent(/agent resisted/i);
    expect(screen.queryByRole('button', { name: /compromise step/i })).not.toBeInTheDocument();
    const verdict = screen.getByRole('complementary', { name: /detector verdict/i });
    expect(within(verdict).getByText('NOT COMPROMISED')).toBeInTheDocument();
    // Still a full replay: the transcript and the transport are unchanged.
    const timeline = screen.getByRole('list', { name: /step timeline/i });
    expect(within(timeline).getAllByRole('button')).toHaveLength(run.trace.steps.length);
    expect(screen.getByRole('button', { name: /^Play$/ })).toBeInTheDocument();
  });

  /**
   * AND IT EXPORTS A RUN RESULT, NOT A FIX REPORT. Same route, same record, but
   * the noun follows the verdict: offering a "fix report" for a run with nothing
   * to fix tells the reader their clean run was a fix report that failed to turn
   * up. A compromise keeps the fix-report wording, which is what the e2e
   * critical path clicks through.
   */
  it('offers a run result, not a fix report, when there is nothing to fix', async () => {
    const compromisedRun = await sampleRun();
    const clean: RunResult = {
      ...compromisedRun,
      verdict: {
        runId: compromisedRun.verdict.runId,
        compromised: false,
        score: 0.03,
        severity: 'None',
        category: compromisedRun.verdict.category,
        rationale: 'The agent did not act on the injected instruction.',
      },
    };
    const { unmount } = render(<Replay run={clean} routeId={ROUTE_ID} />);
    expect(screen.getByRole('link', { name: /export run result/i })).toHaveAttribute(
      'href',
      `/findings/${ROUTE_ID}`,
    );
    expect(screen.queryByRole('link', { name: /export fix report/i })).not.toBeInTheDocument();
    unmount();

    render(<Replay run={compromisedRun} routeId={ROUTE_ID} />);
    expect(screen.getByRole('link', { name: /export fix report/i })).toBeInTheDocument();
  });
});

describe('sample verdicts — copy hygiene', () => {
  it('carries no em dashes in any rationale (UI copy rule)', () => {
    for (const [category, v] of Object.entries(SAMPLE_VERDICTS)) {
      expect(v.rationale, `${category} rationale`).not.toMatch(/—/);
    }
  });
});

describe('Replay — verdict terminal', () => {
  it('prints the outcome + an export y/n prompt (no rationale prose); n prints ok', async () => {
    const run = await sampleRun();
    if (!run.verdict.compromised) throw new Error('sample must be compromised');
    const user = userEvent.setup();
    render(<Replay run={run} routeId={ROUTE_ID} />);

    const verdict = screen.getByRole('complementary', { name: /detector verdict/i });
    // Outcome is shown as terminal output; the rationale prose is gone.
    expect(within(verdict).getByText('COMPROMISED')).toBeInTheDocument();
    expect(screen.queryByText(run.verdict.rationale)).not.toBeInTheDocument();

    // Export is a y/n command: declining (n) prints ok, the y is the fix-report link.
    await user.click(within(verdict).getByRole('button', { name: /decline export/i }));
    expect(within(verdict).getByText(/^>\s*ok$/)).toBeInTheDocument();
  });
});
