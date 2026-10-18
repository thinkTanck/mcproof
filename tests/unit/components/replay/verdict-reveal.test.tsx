import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Replay } from '@/components/replay';
import { getDataSource } from '@/data/source';
import type { RunResult } from '@/contract';

/**
 * THE VERDICT IS REVEALED, NOT SHOWN AT LOAD (owner ruling 2026-10-17 13:19).
 *
 * The detector reads the whole trace after the run, so a replay must not show
 * its verdict mid-run. During playback the detector panel waits; at the last
 * step (played, stepped or scrubbed to) the verdict prints, the offending step
 * gets its marker and the title badge appears. "Show verdict now", the first
 * thing in the replay's focus order, reveals all of it at once, and the reveal
 * is announced politely. Held here for every one of the seven samples and for
 * a live run, compromised and clean.
 */

const WAITING = 'waiting for the run to finish...';
const ROUTE_ID = 'route-row-4242';

const samples = await getDataSource().listRuns();

/** A saved live run: a sample's trace under a live model and a row id route. */
function liveRun(base: RunResult, compromised: boolean): RunResult {
  const verdict = compromised
    ? { ...base.verdict }
    : {
        ...base.verdict,
        compromised: false,
        severity: 'None',
        stepId: undefined,
        rationale: 'The agent did the task and did not act on the attack.',
      };
  return { ...base, model: 'claude-code-live', verdict } as RunResult;
}

const live = [
  { name: 'live run, compromised', run: liveRun(samples[0]!, true) },
  { name: 'live run, clean', run: liveRun(samples[0]!, false) },
];
const cases = [...samples.map((run) => ({ name: `sample ${run.category}`, run })), ...live];

function rail() {
  return screen.getByRole('complementary', { name: 'Detector verdict' });
}

function expectHidden(run: RunResult) {
  expect(screen.queryByTestId('run-outcome')).toBeNull();
  expect(rail()).toHaveTextContent(WAITING);
  expect(within(rail()).queryByText(/^outcome/)).toBeNull();
  expect(screen.queryByRole('link', { name: /^Open (fix report|run result)$/ })).toBeNull();
  expect(screen.queryAllByRole('button', { name: /the agent was compromised here/i })).toHaveLength(
    0,
  );
  expect(document.querySelectorAll('[data-breach-mark]')).toHaveLength(0);
  // The mark the header's run chip is hidden by while the verdict waits.
  expect(document.querySelector('[data-verdict-pending]')).not.toBeNull();
  expect(screen.getByTestId('verdict-announcement')).toHaveTextContent('');
  void run;
}

function expectShown(run: RunResult) {
  const outcome = screen.getByTestId('run-outcome');
  expect(outcome).toHaveTextContent(
    run.verdict.compromised ? /^COMPROMISED AT STEP \d+$/ : 'AGENT RESISTED',
  );
  expect(rail()).not.toHaveTextContent(WAITING);
  expect(rail()).toHaveTextContent(run.verdict.compromised ? 'COMPROMISED' : 'NOT COMPROMISED');
  expect(
    screen.getByRole('link', {
      name: run.verdict.compromised ? 'Open fix report' : 'Open run result',
    }),
  ).toHaveAttribute('href', `/findings/${ROUTE_ID}`);
  const marked = run.verdict.compromised ? 1 : 0;
  expect(screen.queryAllByRole('button', { name: /the agent was compromised here/i })).toHaveLength(
    marked,
  );
  expect(document.querySelectorAll('[data-breach-mark]')).toHaveLength(marked);
  expect(document.querySelector('[data-verdict-pending]')).toBeNull();
  expect(screen.getByTestId('verdict-announcement')).toHaveTextContent(
    run.verdict.compromised ? /compromised at step \d+/i : /agent resisted/i,
  );
  expect(screen.queryByRole('button', { name: 'Show verdict now' })).toBeNull();
}

it('covers all seven samples', () => {
  expect(samples).toHaveLength(7);
});

describe.each(cases)('$name', ({ run }) => {
  it('hides the verdict at step 1, while the run plays', () => {
    render(<Replay run={run} routeId={ROUTE_ID} />);
    expectHidden(run);
    expect(screen.getByRole('button', { name: 'Show verdict now' })).toBeVisible();
  });

  it('shows the verdict once the playhead reaches the last step', () => {
    render(<Replay run={run} routeId={ROUTE_ID} />);
    const [slider] = screen.getAllByRole('slider', { name: /scrub to step/i });
    fireEvent.change(slider!, { target: { value: String(run.trace.steps.length - 2) } });
    expectHidden(run);
    fireEvent.change(slider!, { target: { value: String(run.trace.steps.length - 1) } });
    expectShown(run);
    // Once seen it stays seen: scrubbing back does not take it away.
    fireEvent.change(slider!, { target: { value: '0' } });
    expectShown(run);
  });

  it('shows the verdict at once after "Show verdict now", which is first in focus order', async () => {
    const user = userEvent.setup();
    render(<Replay run={run} routeId={ROUTE_ID} />);
    await user.tab();
    const show = screen.getByRole('button', { name: 'Show verdict now' });
    expect(show).toHaveFocus();
    await user.keyboard('{Enter}');
    expectShown(run);
    // Focus is not dropped to the page: it lands on the outcome it revealed.
    expect(screen.getByTestId('run-outcome')).toHaveFocus();
  });

  it('hides it again after RESET', async () => {
    const user = userEvent.setup();
    render(<Replay run={run} routeId={ROUTE_ID} />);
    await user.click(screen.getByRole('button', { name: 'Show verdict now' }));
    expectShown(run);
    await act(async () => {
      await user.click(screen.getAllByRole('button', { name: /restart/i })[0]!);
    });
    expectHidden(run);
  });
});

it('announces the reveal politely, in a region that is there before it', () => {
  const run = samples[0]!;
  render(<Replay run={run} routeId={ROUTE_ID} />);
  const region = screen.getByTestId('verdict-announcement');
  expect(region).toHaveAttribute('aria-live', 'polite');
  expect(region).toHaveTextContent('');
  fireEvent.click(screen.getByRole('button', { name: 'Show verdict now' }));
  expect(region).toHaveTextContent(/^Verdict: /);
  expect(region.textContent).not.toMatch(/—/);
});
