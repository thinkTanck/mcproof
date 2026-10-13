import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectScreen } from '@/components/connect/ConnectScreen';
import { LiveRunConsole } from '@/components/connect/LiveRunConsole';
import { RUN_CONTROLS_ID, RUN_CONTROLS_LABEL } from '@/components/connect/run-controls';
import type {
  ConnectLiveRunPort,
  LiveRunStatusView,
  LiveRunTicketView,
} from '@/components/connect/live-run-port';

/**
 * WHERE "SKIP TO RUN CONTROLS" LANDS (UI audit 2026-10-12, batch B).
 *
 * One element carries `RUN_CONTROLS_ID` at a time. With no run on show it is
 * the block that starts one, named "Run controls". With a run on show it is
 * the run bar, which is already a region named by the run's heading. Either
 * way it can be focused by script and is not a tab stop, and it is never a
 * live region itself.
 *
 * Where it lands on screen (clear of the header, the bar at the bottom of a
 * phone) is measured in tests/e2e/buttons-targets-nav-skip.spec.ts.
 */

const TICKET: LiveRunTicketView = {
  runId: 'run-77',
  endpoint: 'https://mcproof.dev/api/mcp/run-77',
  token: 'rt_secret',
  expiresAt: '2099-01-01T00:00:00.000Z',
  category: 'ASI01',
  kind: 'malicious',
  promptName: 'session_brief',
  taskGoal: 'Clear the finance inbox.',
};

const STATUS: LiveRunStatusView = {
  runId: 'run-77',
  phase: 'waiting',
  connectedAt: null,
  lastSeenAt: null,
  steps: 0,
  toolCalls: 0,
  finishedAt: null,
};

function port(): ConnectLiveRunPort {
  return {
    start: vi.fn(async () => ({ ok: true as const, value: TICKET })),
    readState: vi.fn(async () => ({ ok: true as const, value: STATUS })),
    finish: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_NOT_FOUND' as const, message: 'not found' },
    })),
    reattach: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_NOT_FOUND' as const, message: 'not found' },
    })),
  };
}

const landings = () => document.querySelectorAll(`#${RUN_CONTROLS_ID}`);

function expectALandingPlace(el: Element) {
  expect(el).toHaveAttribute('tabindex', '-1');
  expect(el).not.toHaveAttribute('aria-live');
  expect(el.getAttribute('role') ?? '').not.toMatch(/status|alert|log/);
}

describe('no run on show: the block that starts one', () => {
  beforeEach(() => window.localStorage.clear());

  it('sample mode: a group named "Run controls" around the play button', () => {
    render(<ConnectScreen />);
    expect(landings()).toHaveLength(1);
    const group = screen.getByRole('group', { name: RUN_CONTROLS_LABEL });
    expect(group).toHaveAttribute('id', RUN_CONTROLS_ID);
    expectALandingPlace(group);
    expect(within(group).getByRole('link', { name: /play sample run/i })).toBeInTheDocument();
  });

  it('live, signed out: the same group, around the sign-in gate', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn={false} />);
    await user.click(screen.getByRole('button', { name: /^live/i }));
    expect(landings()).toHaveLength(1);
    const group = screen.getByRole('group', { name: RUN_CONTROLS_LABEL });
    expectALandingPlace(group);
    expect(within(group).getByRole('link', { name: /sign in/i })).toBeInTheDocument();
  });

  it('live, signed in, nothing issued: the same group, around ISSUE RUN ENDPOINT', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn livePort={port()} />);
    await user.click(screen.getByRole('button', { name: /^live/i }));
    expect(landings()).toHaveLength(1);
    const group = screen.getByRole('group', { name: RUN_CONTROLS_LABEL });
    expectALandingPlace(group);
    expect(within(group).getByRole('button', { name: /issue run endpoint/i })).toBeInTheDocument();
  });
});

describe('a run on show: the run bar', () => {
  beforeEach(() => window.localStorage.clear());

  it('the id moves from the starting block to the bar, and is never on two elements', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn livePort={port()} />);
    await user.click(screen.getByRole('button', { name: /^live/i }));
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));

    const bar = await screen.findByRole('region', { name: /what we have actually seen/i });
    await waitFor(() => expect(bar).toHaveAttribute('id', RUN_CONTROLS_ID));
    await waitFor(() => expect(landings()).toHaveLength(1));
    expectALandingPlace(bar);
    // The starting block is a plain wrapper again: no name, no role, no focus.
    expect(screen.queryByRole('group', { name: RUN_CONTROLS_LABEL })).not.toBeInTheDocument();
    // The one live region on the bar is still the status inside it.
    expect(within(bar).getAllByRole('status')).toHaveLength(1);
  });

  it('the console by itself: the bar carries the id and is named by the run heading', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={port()} category="ASI01" signedIn />);
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    const bar = await screen.findByRole('region', { name: /what we have actually seen/i });
    expect(bar).toHaveAttribute('id', RUN_CONTROLS_ID);
    expect(bar).toHaveAttribute('aria-labelledby', 'connect-state');
    expectALandingPlace(bar);
  });
});
