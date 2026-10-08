import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectScreen } from '@/components/connect/ConnectScreen';
import type {
  ConnectLiveRunPort,
  LiveRunStatusView,
  LiveRunSummaryView,
  LiveRunTicketView,
} from '@/components/connect/live-run-port';

/**
 * THE LINE UNDER THE TASK PREVIEW NEVER POINTS AT SOMETHING THAT IS NOT DRAWN
 * (sweep 2026-10-07, C1).
 *
 * With a run open, the preview says "Lined up for your next run. The run you
 * issued keeps its own task, shown in the last step." That is true while the run
 * draws its task. An EXPIRED run stopped drawing it in #180, and the line went
 * on pointing at a last step that was no longer there, for a run that was dead.
 *
 * An expired run has nothing left to keep, so it reads exactly as having no run.
 */

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams(),
}));

const NO_RUN = 'Issue a run to get your endpoint and token.';
const RUN_OPEN =
  'Lined up for your next run. The run you issued keeps its own task, shown in the last step.';

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

const ticket = (expiresAt: string): LiveRunTicketView => ({
  runId: 'run-1',
  endpoint: 'https://mcproof.dev/api/mcp/run-1',
  token: 'rt_secret',
  expiresAt,
  category: 'ASI02',
  kind: 'malicious',
  promptName: 'session_brief',
  taskGoal: 'The task this run was issued with.',
});

const status = (phase: LiveRunStatusView['phase']): LiveRunStatusView => ({
  runId: 'run-1',
  phase,
  connectedAt: null,
  lastSeenAt: null,
  steps: phase === 'waiting' ? 2 : 9,
  toolCalls: phase === 'waiting' ? 0 : 4,
  finishedAt: null,
});

const SUMMARY: LiveRunSummaryView = {
  runId: 'run-1',
  storedRunId: '3f2b6c1e-8a4d-4c1b-9e57-0a1b2c3d4e5f',
  compromised: false,
  category: 'ASI02',
  severity: 'None',
  stepId: null,
  steps: 9,
};

/** A port whose tickets carry the given expiries, in order; the last one repeats. */
function port(phase: LiveRunStatusView['phase'], ...expiries: string[]): ConnectLiveRunPort {
  let issued = 0;
  return {
    start: vi.fn(async () => ({
      ok: true as const,
      value: ticket(expiries[Math.min(issued++, expiries.length - 1)]!),
    })),
    readState: vi.fn(async () => ({ ok: true as const, value: status(phase) })),
    finish: vi.fn(async () => ({ ok: true as const, value: SUMMARY })),
    reattach: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_NOT_FOUND' as const, message: 'That run was not found.' },
    })),
  };
}

const GOALS = { ASI02: 'The task the picker has selected.' } as const;

/** The helper line: the third paragraph of the preview box, under the goal. */
const helper = () =>
  document.getElementById('connect-task-preview')!.parentElement!.querySelectorAll('p')[2]!;
const bar = () => screen.getByRole('region', { name: /what we have actually seen/i });

async function live(livePort: ConnectLiveRunPort) {
  const user = userEvent.setup();
  render(<ConnectScreen signedIn livePort={livePort} categoryGoals={GOALS} />);
  await user.click(screen.getByRole('button', { name: /^LIVE/ }));
  return user;
}
const issue = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /issue run endpoint/i }));

describe('ConnectScreen · the line under the task preview, signed in and live', () => {
  it('no run: says to issue one', async () => {
    await live(port('waiting', FUTURE));

    expect(helper()).toHaveTextContent(NO_RUN);
    expect(helper().textContent).toBe(NO_RUN);
  });

  it('awaiting run: the issued run keeps its own task, which is on the page', async () => {
    const user = await live(port('waiting', FUTURE));
    await issue(user);
    await within(bar()).findByText('AWAITING AGENT');

    expect(helper().textContent).toBe(RUN_OPEN);
    // What the line points at is really there.
    expect(screen.getByRole('region', { name: /give your agent its task/i })).toBeVisible();
  });

  it('connected run: the same line, and the task is still on the page', async () => {
    const user = await live(port('connected', FUTURE));
    await issue(user);
    await within(bar()).findByText('AGENT CONNECTED');

    expect(helper().textContent).toBe(RUN_OPEN);
    expect(screen.getByRole('region', { name: /give your agent its task/i })).toBeVisible();
  });

  it('finished run: says to issue one, as #190 left it', async () => {
    const user = await live(port('connected', FUTURE));
    await issue(user);
    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));
    await within(bar()).findByText('RUN FINISHED');

    await waitFor(() => expect(helper().textContent).toBe(NO_RUN));
  });

  it('expired run: exactly the no-run line, and nothing about a last step', async () => {
    const user = await live(port('waiting', PAST));
    const withNoRun = helper().textContent;
    await issue(user);
    await within(bar()).findByText('RUN EXPIRED');

    await waitFor(() => expect(helper().textContent).toBe(withNoRun));
    expect(helper().textContent).toBe(NO_RUN);
    expect(helper()).not.toHaveTextContent(/last step|keeps its own task|next run/i);
    // The thing the old line pointed at is not on the page.
    expect(
      screen.queryByRole('region', { name: /give your agent its task/i }),
    ).not.toBeInTheDocument();
  });

  it('expired run: the preview goal itself still follows the picker', async () => {
    const user = await live(port('waiting', PAST));
    await issue(user);
    await within(bar()).findByText('RUN EXPIRED');

    expect(
      document.getElementById('connect-task-preview')!.parentElement!.querySelectorAll('p')[1],
    ).toHaveTextContent(GOALS.ASI02);
  });

  it('after an expired run is let go and a fresh one issued: back to the run-open line', async () => {
    const user = await live(port('waiting', PAST, FUTURE));
    await issue(user);
    await within(bar()).findByText('RUN EXPIRED');
    await waitFor(() => expect(helper().textContent).toBe(NO_RUN));

    await user.click(screen.getByRole('button', { name: /issue a fresh run/i }));
    expect(helper().textContent).toBe(NO_RUN);

    await issue(user);
    await within(bar()).findByText('AWAITING AGENT');
    await waitFor(() => expect(helper().textContent).toBe(RUN_OPEN));
  });
});
