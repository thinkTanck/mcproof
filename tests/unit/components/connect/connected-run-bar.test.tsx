import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LiveRunConsole } from '@/components/connect/LiveRunConsole';
import type {
  ConnectLiveRunPort,
  LiveRunStatusView,
  LiveRunSummaryView,
  LiveRunTicketView,
} from '@/components/connect/live-run-port';

/**
 * THE CONNECTED BAR ON A PHONE: TWO ROWS, A SHORT LABEL, THE SAME MEANING
 * (sweep 2026-10-07, C3).
 *
 * jsdom lays nothing out, so heights and rows are measured in a browser
 * (tests/e2e/connected-run-bar.spec.ts). What is held here is the part that does
 * not depend on layout: what the control is called, what the status region
 * contains, and that only the connected state takes the phone layout.
 */

const TICKET: LiveRunTicketView = {
  runId: 'run-77',
  endpoint: 'https://mcpwn.dev/api/mcp/run-77',
  token: 'mcpwn_rt_secret',
  expiresAt: '2099-01-01T00:00:00.000Z',
  category: 'ASI01',
  kind: 'malicious',
  promptName: 'session_brief',
  taskGoal: 'Clear the finance inbox.',
};

const status = (phase: LiveRunStatusView['phase']): LiveRunStatusView => ({
  runId: 'run-77',
  phase,
  connectedAt: null,
  lastSeenAt: null,
  steps: 9,
  toolCalls: 4,
  finishedAt: null,
});

const SUMMARY: LiveRunSummaryView = {
  runId: 'run-77',
  storedRunId: '3f2b6c1e-8a4d-4c1b-9e57-0a1b2c3d4e5f',
  compromised: false,
  category: 'ASI01',
  severity: 'None',
  stepId: null,
  steps: 9,
};

function portWith(phase: LiveRunStatusView['phase'], finish?: ConnectLiveRunPort['finish']) {
  return {
    start: vi.fn(async () => ({ ok: true as const, value: TICKET })),
    readState: vi.fn(async () => ({ ok: true as const, value: status(phase) })),
    finish: finish ?? vi.fn(async () => ({ ok: true as const, value: SUMMARY })),
    reattach: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_NOT_FOUND' as const, message: 'not found' },
    })),
  } satisfies ConnectLiveRunPort;
}

const dock = () => screen.getByRole('region', { name: /what we have actually seen/i });

async function issue(port: ConnectLiveRunPort, settle: string) {
  const user = userEvent.setup();
  render(<LiveRunConsole port={port} category="ASI01" signedIn />);
  await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
  await within(dock()).findByText(settle);
  return user;
}

describe('connected: the end-run control', () => {
  it('is named "End run and judge", with the same tooltip, at every width', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');
    const button = within(dock()).getByRole('button', { name: 'End run and judge' });

    expect(button).toHaveAttribute('title', 'End run and judge');
  });

  it('shows END RUN below 640px and the full words from 640px up', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');
    const button = within(dock()).getByRole('button', { name: 'End run and judge' });

    const short = within(button).getByText('END RUN', { exact: true });
    const full = within(button).getByText('END RUN AND JUDGE', { exact: true });
    expect(short.className).toMatch(/\bsm:hidden\b/);
    expect(full.className).toMatch(/\bhidden\b/);
    expect(full.className).toMatch(/\bsm:inline\b/);
    // Label in name (WCAG 2.5.3), for both visible labels.
    for (const visible of ['END RUN', 'END RUN AND JUDGE']) {
      expect('End run and judge'.toLowerCase()).toContain(visible.toLowerCase());
    }
  });

  it('while judging reads JUDGING, and is named by what it shows', async () => {
    let answer!: (v: { ok: true; value: LiveRunSummaryView }) => void;
    const finish = vi.fn(
      () =>
        new Promise<{ ok: true; value: LiveRunSummaryView }>((resolve) => {
          answer = resolve;
        }),
    );
    const user = await issue(portWith('connected', finish), 'AGENT CONNECTED');
    await user.click(within(dock()).getByRole('button', { name: 'End run and judge' }));

    const judging = within(dock()).getByRole('button', { name: 'JUDGING' });
    expect(judging).toHaveTextContent('JUDGING');
    expect(judging).not.toHaveAttribute('aria-label');
    answer({ ok: true, value: SUMMARY });
  });
});

describe('connected: the status region', () => {
  it('holds the phase reading and the count, and no control', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');
    const region = within(dock()).getByRole('status');

    expect(region).toHaveTextContent('AGENT CONNECTED');
    expect(region).toHaveTextContent('4tool calls');
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
  });

  it('lays the reading and the count on the bar grid below 640px, and as before from 640px up', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');
    const region = within(dock()).getByRole('status');

    // A subgrid of the bar's row, so its two pieces line up with the control
    // without leaving the one region a screen reader announces.
    expect(region.className).toMatch(/\bgrid-cols-subgrid\b/);
    expect(region.className).toMatch(/\bgrid-rows-subgrid\b/);
    // From 640px up, the flex row it always was.
    expect(region.className).toMatch(/\bsm:flex\b/);
    expect(region.className).toMatch(/\bsm:flex-1\b/);
  });
});

describe('every other state keeps the bar it had', () => {
  it.each([
    ['waiting', 'AWAITING AGENT'],
    ['finished', 'RUN FINISHED'],
  ] as const)('%s: no phone grid', async (phase, settle) => {
    await issue(portWith(phase), settle);
    const region = within(dock()).getByRole('status');

    expect(region.className).toBe('flex flex-1 flex-wrap items-center gap-x-4 gap-y-2');
    expect(within(dock()).queryByRole('button', { name: 'End run and judge' })).toBeNull();
  });
});
