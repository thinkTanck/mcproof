import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LiveRunConsole } from '@/components/connect/LiveRunConsole';
import type {
  ConnectLiveRunPort,
  LiveRunReattachView,
  LiveRunStatusView,
  LiveRunSummaryView,
  LiveRunTicketView,
} from '@/components/connect/live-run-port';

/**
 * THE LIVE CONSOLE under the inverted model (ADR-0006): we host the MCP endpoint
 * and the user's agent connects to US. So this panel ISSUES a per-run endpoint
 * and token, explains how the task goal travels out of band, waits on state the
 * server really observed, and ends the run when the user says the agent is done.
 *
 * Four things this suite exists to hold down:
 *   1. the token is a secret shown once — masked by default, copyable, and never
 *      handed to anything that persists it;
 *   2. a refusal is calm, typed, and quotes no numeral the screen authored;
 *   3. a state we cannot observe is never drawn as if we could;
 *   4. AGENT ACTIVITY IS `toolCalls`, NOT `steps`. The trace count includes the
 *      task goal we sent and the completion step we infer, so it is never zero
 *      even when the agent did nothing at all. Printing it as activity would
 *      assert something that never happened.
 */

const TICKET: LiveRunTicketView = {
  runId: 'run-77',
  endpoint: 'https://mcpwn.dev/api/mcp/run-77',
  token: `mcpwn_rt_${'a'.repeat(32)}_${'b'.repeat(64)}`,
  expiresAt: '2099-01-01T00:00:00.000Z',
  category: 'ASI01',
  kind: 'malicious',
  promptName: 'session_brief',
  taskGoal: 'Clear the finance inbox and act on anything that needs a reply.',
};

/** A run that exists and that nothing has connected to. Steps is 2, not 0. */
const WAITING: LiveRunStatusView = {
  runId: 'run-77',
  phase: 'waiting',
  connectedAt: null,
  lastSeenAt: null,
  steps: 2,
  toolCalls: 0,
  finishedAt: null,
};

const SUMMARY: LiveRunSummaryView = {
  runId: 'run-77',
  storedRunId: 'stored-77',
  compromised: true,
  category: 'ASI01',
  severity: 'High',
  stepId: 's4',
  steps: 11,
};

/** The same run as TICKET, handed back by id: every field except the token. */
const REATTACH: LiveRunReattachView = {
  runId: TICKET.runId,
  endpoint: TICKET.endpoint,
  expiresAt: TICKET.expiresAt,
  category: TICKET.category,
  kind: TICKET.kind,
  promptName: TICKET.promptName,
  taskGoal: TICKET.taskGoal,
  finishedAt: null,
  storedRunId: null,
};

const statusOf = (over: Partial<LiveRunStatusView>) => ({
  ok: true as const,
  value: { ...WAITING, ...over },
});

function portWith(overrides: Partial<ConnectLiveRunPort> = {}): ConnectLiveRunPort {
  return {
    start: vi.fn(async () => ({ ok: true as const, value: TICKET })),
    readState: vi.fn(async () => ({ ok: true as const, value: WAITING })),
    finish: vi.fn(async () => ({ ok: true as const, value: SUMMARY })),
    reattach: vi.fn(async () => ({ ok: true as const, value: REATTACH })),
    ...overrides,
  };
}

/** Refuse every call with one code and one sentence, the way a gate does. */
function refusingPort(code: string, message: string): ConnectLiveRunPort {
  const refusal = { ok: false as const, refusal: { code: code as never, message } };
  return {
    start: vi.fn(async () => refusal),
    readState: vi.fn(async () => refusal),
    finish: vi.fn(async () => refusal),
    reattach: vi.fn(async () => refusal),
  };
}

/**
 * The sentences that explain a reading. They sit under the pinned run bar and
 * scroll with the page, so the bar itself can stay short enough to pin.
 */
const detail = () => screen.getByTestId('run-state-detail');

/**
 * The run bar's own status reading. The console holds more than one status
 * region (the notices announce into regions of their own), so the bar is reached
 * through the pinned dock that holds it rather than as "the" status.
 */
const runBar = () =>
  within(screen.getByRole('region', { name: /what we have actually seen/i })).getByRole('status');
const findRunBar = async () =>
  within(await screen.findByRole('region', { name: /what we have actually seen/i })).getByRole(
    'status',
  );

const issue = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /issue run endpoint/i }));

function stubClipboard() {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('LiveRunConsole · the inverted model, stated on the screen', () => {
  it('says WE host the endpoint and the agent connects to us, before anything is issued', () => {
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);

    expect(screen.getByText(/point your agent at an endpoint we host/i)).toBeInTheDocument();
    // The retired model must not survive anywhere in the copy.
    expect(document.body.textContent).not.toMatch(/your agent's (endpoint|api key)/i);
  });

  it('asks for no endpoint, no key, and offers no field a secret could be pasted into', () => {
    const { container } = render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);

    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).not.toMatch(/never stored/i);
  });

  it('issues for the category the run will actually serve', async () => {
    const user = userEvent.setup();
    const port = portWith();
    render(<LiveRunConsole port={port} category="ASI05" signedIn />);

    await issue(user);

    expect(port.start).toHaveBeenCalledWith({ category: 'ASI05', kind: 'malicious' });
  });

  it('issues for the framing it was given, not for the attack every time', async () => {
    const user = userEvent.setup();
    const port = portWith();
    render(<LiveRunConsole port={port} category="ASI05" kind="benign" signedIn />);

    await issue(user);

    expect(port.start).toHaveBeenCalledWith({ category: 'ASI05', kind: 'benign' });
  });

  it('describes the control as the same surface with no attack staged on it', () => {
    render(<LiveRunConsole port={portWith()} category="ASI01" kind="benign" signedIn />);

    // Pinned to the console's OWN lead, which is the phrase the signed-in e2e
    // scan binds to. The setup section states parity in nearly the same words,
    // so a match on the tail alone would find two elements on the real screen
    // and prove neither.
    expect(
      screen.getByText(/We serve the same tool surface for the category you picked/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no attack staged on it/i)).toBeInTheDocument();
  });
});

/**
 * WHICH RUN THIS TICKET IS. A user can issue several tickets in a session, and
 * an endpoint that does not say which framing it serves is an endpoint they
 * cannot tell apart from the last one. It is read off the TICKET the server
 * issued, not off the picker, and it is evidence: printed as read, never
 * animated.
 */
describe('LiveRunConsole · the issued ticket says which run it is serving', () => {
  const ticketOf = (kind: LiveRunTicketView['kind']) => ({
    start: vi.fn(async () => ({ ok: true as const, value: { ...TICKET, kind } })),
    readState: vi.fn(async () => ({ ok: true as const, value: WAITING })),
    finish: vi.fn(async () => ({ ok: true as const, value: SUMMARY })),
    reattach: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_NOT_FOUND' as const, message: 'That run was not found.' },
    })),
  });

  it('names an attack run beside the category it is serving', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={ticketOf('malicious')} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText(TICKET.endpoint);

    expect(screen.getByText('ASI01')).toBeInTheDocument();
    expect(screen.getByText('ATTACK RUN')).toBeInTheDocument();
  });

  it('names a control run, in the words the setup used, never the wire value', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={ticketOf('benign')} category="ASI01" kind="benign" signedIn />);
    await issue(user);
    await screen.findByText(TICKET.endpoint);

    expect(screen.getByText('CONTROL RUN')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bbenign\b/i);
  });
});

describe('LiveRunConsole · the per-run token is a secret shown once', () => {
  it('shows the endpoint in full and keeps the token masked until it is revealed', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);

    expect(await screen.findByText(TICKET.endpoint)).toBeInTheDocument();
    expect(screen.queryByText(TICKET.token)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reveal run token/i }));

    expect(screen.getByText(TICKET.token)).toBeInTheDocument();
  });

  it('copies the real token even while it is masked', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText(TICKET.endpoint);

    await user.click(screen.getByRole('button', { name: /copy run token/i }));

    expect(writeText).toHaveBeenCalledWith(TICKET.token);
  });

  it('says the token is shown once and states what a leaked one is worth', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText(TICKET.endpoint);

    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
    expect(screen.getByText(/hostile by design/i)).toBeInTheDocument();
  });

  it('never puts the token anywhere the browser would keep it', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText(TICKET.endpoint);
    await user.click(screen.getByRole('button', { name: /reveal run token/i }));

    // No form control (autofill, password managers), no storage, no URL.
    expect(document.querySelector('input')).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(TICKET.token);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(TICKET.token);
    expect(window.location.href).not.toContain(TICKET.token);
  });
});

describe('LiveRunConsole · the task goal travels out of band', () => {
  it('names the published prompt first and says why the goal cannot be pushed', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText(TICKET.endpoint);

    expect(screen.getByText('session_brief')).toBeInTheDocument();
    expect(
      screen.getByText(/MCP has no message that lets a server tell an agent what its job is/i),
    ).toBeInTheDocument();
  });

  it('always offers the paste fallback with the exact goal text, copyable', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText(TICKET.endpoint);

    expect(screen.getByText(TICKET.taskGoal)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /copy task goal/i }));

    expect(writeText).toHaveBeenCalledWith(TICKET.taskGoal);
  });
});

describe('LiveRunConsole · real connection state, and only real connection state', () => {
  it('reads the run state as soon as the endpoint is issued', async () => {
    const user = userEvent.setup();
    const port = portWith();
    render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);

    await waitFor(() => expect(port.readState).toHaveBeenCalledWith({ runId: 'run-77' }));
  });

  it('says nothing has connected yet, rather than implying progress', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);

    expect(await screen.findByText(/no agent has connected yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  /**
   * THE ONE THAT WOULD HAVE LIED. `steps` is 2 on a run nothing has touched,
   * because it counts the task goal and the inferred completion. The headline
   * numeral must be `toolCalls`, which is 0, and the trace count must be named
   * for what it is.
   */
  it('reports zero agent activity on a run nothing has connected to', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText(/no agent has connected yet/i);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText(/tool calls/i)).toBeInTheDocument();
    // The trace count is present but never passes itself off as activity.
    expect(screen.getByText(/the trace holds 2 steps in total/i)).toBeInTheDocument();
    expect(screen.getByText(/counts the task goal we sent and the completion step/i)).toBeVisible();
  });

  it('reports the tool calls the agent actually chose to make', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () =>
        statusOf({
          phase: 'connected',
          steps: 9,
          toolCalls: 6,
          lastSeenAt: '2026-08-05T11:31:00Z',
        }),
      ),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);

    expect(await screen.findByText('6')).toBeInTheDocument();
    expect(screen.getByText(/tool calls/i)).toBeInTheDocument();
    expect(screen.getByText(/your agent is calling tools/i)).toBeInTheDocument();
  });

  /**
   * "LAST SEEN never" beside a connected agent and a tool-call count was a false
   * statement on the screen. No durable timestamp exists yet, so the reading is
   * omitted rather than filled with a word that claims the opposite of what the
   * rest of the panel shows.
   */
  it('never says LAST SEEN never for an agent that has connected', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () =>
        statusOf({ phase: 'connected', steps: 8, toolCalls: 3, lastSeenAt: null }),
      ),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);

    const panel = await findRunBar();
    expect(await within(panel).findByText('AGENT CONNECTED')).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/never/i);
    expect(detail()).not.toHaveTextContent('LAST SEEN');
  });

  it('omits LAST SEEN while waiting too, since no time is recorded either way', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText(/no agent has connected yet/i);

    expect(detail()).not.toHaveTextContent('LAST SEEN');
  });

  it('prints LAST SEEN when the server does report a time', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () =>
        statusOf({ phase: 'connected', toolCalls: 1, lastSeenAt: '2026-08-05T11:31:00Z' }),
      ),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);

    expect(await screen.findByText('AGENT CONNECTED')).toBeInTheDocument();
    expect(detail()).toHaveTextContent('LAST SEEN 2026-08-05T11:31:00Z');
  });

  it('separates "the agent is here" from "the agent has done something"', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 0, steps: 2 })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);

    expect(await screen.findByText(/has not called a tool yet/i)).toBeInTheDocument();
  });

  it('states plainly that reasoning is not observable and is never invented', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText(/no agent has connected yet/i);

    expect(screen.getByText(/we record what your agent does, not what it thinks/i)).toBeVisible();
  });
});

describe('LiveRunConsole · a quiet run is told apart from a dead one', () => {
  /** A clock standing on a chosen side of the ticket's expiry. */
  const at = (iso: string) => () => new Date(iso);
  const BEFORE = at('2098-12-31T23:00:00.000Z');
  const AFTER = at('2099-01-01T00:00:01.000Z');
  const panel = runBar;

  it('says what the reading will change to, so AWAITING is not mistaken for broken', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn now={BEFORE} />);
    await issue(user);
    await screen.findByText(/no agent has connected yet/i);

    expect(within(panel()).getByText('AWAITING AGENT')).toBeInTheDocument();
    expect(detail()).toHaveTextContent(/changes to AGENT CONNECTED the moment your agent reaches/i);
  });

  it('moves the reading to AGENT CONNECTED once the agent is there, and drops the hint', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 0, steps: 2 })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn now={BEFORE} />);
    await issue(user);

    expect(await within(panel()).findByText('AGENT CONNECTED')).toBeInTheDocument();
    expect(detail()).not.toHaveTextContent(/changes to AGENT CONNECTED/i);
  });

  it('prints when the run expires, beside the state, exactly as issued', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn now={BEFORE} />);
    await issue(user);
    await screen.findByText(/no agent has connected yet/i);

    expect(detail()).toHaveTextContent(`EXPIRES ${TICKET.expiresAt}`);
    expect(panel()).not.toHaveTextContent('RUN EXPIRED');
  });

  it('says RUN EXPIRED once the clock passes the expiry, instead of waiting for ever', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn now={AFTER} />);
    await issue(user);

    expect(await within(panel()).findByText('RUN EXPIRED')).toBeInTheDocument();
    expect(within(panel()).queryByText('AWAITING AGENT')).toBeNull();
    expect(detail()).toHaveTextContent(/no longer accept connections/i);
    expect(detail()).toHaveTextContent(/issue a new run/i);
    expect(detail()).toHaveTextContent(`EXPIRED ${TICKET.expiresAt}`);
  });

  it('never calls a finished run expired, however old it is', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'finished', toolCalls: 5, steps: 9 })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn now={AFTER} />);
    await issue(user);

    expect(await within(panel()).findByText('RUN FINISHED')).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent('RUN EXPIRED');
  });

  it('keeps an expired run in the neutral state, never red', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn now={AFTER} />);
    await issue(user);

    const label = await within(panel()).findByText('RUN EXPIRED');
    // Inert, exactly like AWAITING: a closed window is not a breach.
    expect(label.getAttribute('style') ?? '').toContain('--status-inert');
    expect(label.className).not.toMatch(/breach|danger|red/);
  });
});

describe('LiveRunConsole · ending the run and handing off', () => {
  it('offers no end control until the agent has actually connected', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText(/no agent has connected yet/i);

    // Ending a run nobody connected to would spend a judge call on nothing.
    expect(screen.queryByRole('button', { name: /end run and judge/i })).not.toBeInTheDocument();
  });

  it('ends the run for the run that was issued, and hands off to its stored replay', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 5, steps: 9 })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);

    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));

    expect(port.finish).toHaveBeenCalledWith({ runId: 'run-77' });
    // The replay is addressed by the PERSISTED row id, not the hosting run id.
    expect(await screen.findByRole('link', { name: /open the replay/i })).toHaveAttribute(
      'href',
      '/runs/stored-77',
    );
  });

  it('offers no replay link while the run is still open', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText(/no agent has connected yet/i);

    expect(screen.queryByRole('link', { name: /open the replay/i })).not.toBeInTheDocument();
  });

  it('states a judge that did not answer, and keeps the endpoint on screen', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 5, steps: 9 })),
      finish: vi.fn(async () => ({
        ok: false as const,
        refusal: {
          code: 'DETECTION_FAILED' as const,
          message: 'The judge could not reach a verdict for this run.',
        },
      })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);
    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));

    expect(await screen.findByText('DETECTOR DID NOT ANSWER')).toBeInTheDocument();
    // The run is not lost: what the user needs to reconnect is still there.
    expect(screen.getByText(TICKET.endpoint)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open the replay/i })).not.toBeInTheDocument();
  });

  it('states an unusable result under its own heading', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 5, steps: 9 })),
      finish: vi.fn(async () => ({
        ok: false as const,
        refusal: {
          code: 'RESULT_INVALID' as const,
          message: 'This run did not produce a valid result.',
        },
      })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);
    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));

    expect(await screen.findByText('RUN RESULT UNUSABLE')).toBeInTheDocument();
  });
});

describe('LiveRunConsole · refusals fail closed and say so calmly', () => {
  it('states an exhausted allowance in the words the server derived from config', async () => {
    const user = userEvent.setup();
    const sentence =
      'This account has reached its limit of 3 free live runs. Sample playback stays open to everyone.';
    render(
      <LiveRunConsole
        port={refusingPort('ALLOWANCE_EXHAUSTED', sentence)}
        category="ASI01"
        signedIn
      />,
    );

    await issue(user);

    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.getByText('FREE LIVE RUNS USED')).toBeInTheDocument();
  });

  it('states a tripped spend cap without ever quoting a number', async () => {
    const user = userEvent.setup();
    const sentence = 'Live runs are paused for now. Sample playback stays open to everyone.';
    render(
      <LiveRunConsole
        port={refusingPort('SPEND_CAP_REACHED', sentence)}
        category="ASI01"
        signedIn
      />,
    );

    await issue(user);

    expect(await screen.findByText('LIVE RUNS PAUSED')).toBeInTheDocument();
    for (const region of screen.getAllByRole('status')) {
      expect(region.textContent).not.toMatch(/\d/);
    }
  });

  it('states an unreadable gate as its own fact, not as being out of runs', async () => {
    const user = userEvent.setup();
    const sentence =
      'We could not check your run allowance just now, so this run did not go ahead. ' +
      'Please try again in a moment.';
    render(
      <LiveRunConsole
        port={refusingPort('GATE_UNAVAILABLE', sentence)}
        category="ASI01"
        signedIn
      />,
    );

    await issue(user);

    expect(await screen.findByText('ALLOWANCE CHECK UNAVAILABLE')).toBeInTheDocument();
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it('issues nothing when a run is refused', async () => {
    const user = userEvent.setup();
    render(
      <LiveRunConsole
        port={refusingPort('SPEND_CAP_REACHED', 'Paused.')}
        category="ASI01"
        signedIn
      />,
    );

    await issue(user);
    await screen.findByText('LIVE RUNS PAUSED');

    expect(screen.queryByRole('button', { name: /copy run token/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy run endpoint/i })).not.toBeInTheDocument();
  });

  it('keeps the sample route open from inside a refusal', async () => {
    const user = userEvent.setup();
    render(
      <LiveRunConsole
        port={refusingPort('ALLOWANCE_EXHAUSTED', 'Used up.')}
        category="ASI01"
        signedIn
      />,
    );

    await issue(user);

    expect(await screen.findByRole('link', { name: /sample run/i })).toHaveAttribute(
      'href',
      '/runs/sample',
    );
  });

  it('states a signed-out refusal as printable copy, not a redirect', async () => {
    const user = userEvent.setup();
    const sentence = 'Sign in to start a live run. The sample run needs no account.';
    render(
      <LiveRunConsole port={refusingPort('NOT_SIGNED_IN', sentence)} category="ASI01" signedIn />,
    );

    await issue(user);

    expect(await screen.findByText(sentence)).toBeInTheDocument();
  });
});

describe('LiveRunConsole · the sign-in gate', () => {
  it('offers no issue control at all when signed out', () => {
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn={false} />);

    expect(screen.queryByRole('button', { name: /issue run endpoint/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/sign-in');
  });
});

/**
 * REATTACH. The run id lives in the URL, so a reload or a navigation away and
 * back hands this console a run id instead of a ticket. It reopens that run from
 * its durable row: the state, the trace count and the END RUN control all come
 * back. The token does not, because it was shown once and only a hash is stored.
 */
describe('LiveRunConsole · reattaching to a run by its id', () => {
  const reattached = (over: Partial<ConnectLiveRunPort> = {}) =>
    portWith({
      readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 3, steps: 8 })),
      ...over,
    });

  it('restores the connected state and the END RUN control without issuing anything', async () => {
    const port = reattached();
    render(<LiveRunConsole port={port} category="ASI01" signedIn reattachRunId="run-77" />);

    expect(await screen.findByText('AGENT CONNECTED')).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();
    expect(screen.getByRole('button', { name: /end run and judge/i })).toBeVisible();
    expect(port.reattach).toHaveBeenCalledWith({ runId: 'run-77' });
    expect(port.readState).toHaveBeenCalledWith({ runId: 'run-77' });
    expect(port.start).not.toHaveBeenCalled();
  });

  it('shows the endpoint and the task goal again, read off the run itself', async () => {
    render(<LiveRunConsole port={reattached()} category="ASI05" signedIn reattachRunId="run-77" />);

    await screen.findByText('AGENT CONNECTED');
    expect(screen.getByText(REATTACH.endpoint)).toBeVisible();
    expect(screen.getByText(REATTACH.promptName)).toBeVisible();
    // The run's own category, not the one the picker happens to be on. It is
    // named twice now: on the SERVING line, and in the notice that says the
    // picker and the run disagree. That notice mounts already showing, so it is
    // written one frame after its region (see the live-region suite) and waited for.
    await screen.findByTestId('run-selection-notice');
    const named = screen.getAllByText('ASI01');
    expect(named).toHaveLength(2);
    for (const el of named) expect(el).toBeVisible();
    expect(screen.getByTestId('run-selection-notice')).toHaveTextContent('ASI05');
  });

  it('shows no token and no client setup, and says why', async () => {
    const { container } = render(
      <LiveRunConsole port={reattached()} category="ASI01" signedIn reattachRunId="run-77" />,
    );

    await screen.findByText('AGENT CONNECTED');
    expect(container.textContent).not.toContain('mcpwn_rt_');
    expect(screen.queryByText('RUN TOKEN')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /register .* client/i })).not.toBeInTheDocument();
    expect(screen.getByText(/we cannot show it again/i)).toBeVisible();
  });

  it('ends a reattached run by its id', async () => {
    const user = userEvent.setup();
    const port = reattached();
    render(<LiveRunConsole port={port} category="ASI01" signedIn reattachRunId="run-77" />);

    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));

    expect(port.finish).toHaveBeenCalledWith({ runId: 'run-77' });
    expect(await screen.findByRole('link', { name: /open the replay/i })).toHaveAttribute(
      'href',
      '/runs/stored-77',
    );
  });

  it('says a run nobody connected to cannot be registered again, and offers a fresh one', async () => {
    const user = userEvent.setup();
    const onRunChange = vi.fn();
    render(
      <LiveRunConsole
        port={portWith()}
        category="ASI01"
        signedIn
        reattachRunId="run-77"
        onRunChange={onRunChange}
      />,
    );

    expect(await screen.findByText('AWAITING AGENT')).toBeVisible();
    expect(screen.getByText(/cannot be registered with a client now/i)).toBeVisible();

    await user.click(screen.getByRole('button', { name: /issue a fresh run/i }));

    expect(screen.getByRole('button', { name: /issue run endpoint/i })).toBeVisible();
    expect(onRunChange).toHaveBeenLastCalledWith(null);
  });

  it('does not offer a fresh run while the agent is connected', async () => {
    render(<LiveRunConsole port={reattached()} category="ASI01" signedIn reattachRunId="run-77" />);

    await screen.findByText('AGENT CONNECTED');
    expect(screen.queryByRole('button', { name: /issue a fresh run/i })).not.toBeInTheDocument();
  });

  it('links a run that had already finished to its saved replay', async () => {
    const port = portWith({
      reattach: vi.fn(async () => ({
        ok: true as const,
        value: { ...REATTACH, finishedAt: '2026-10-02T10:00:00.000Z', storedRunId: 'stored-77' },
      })),
      readState: vi.fn(async () =>
        statusOf({ phase: 'finished', toolCalls: 3, finishedAt: '2026-10-02T10:00:00.000Z' }),
      ),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn reattachRunId="run-77" />);

    expect(await screen.findByRole('link', { name: /open the replay/i })).toHaveAttribute(
      'href',
      '/runs/stored-77',
    );
    expect(screen.queryByRole('button', { name: /end run and judge/i })).not.toBeInTheDocument();
  });

  it('says plainly when a finished run has no saved result, and links nowhere', async () => {
    const port = portWith({
      reattach: vi.fn(async () => ({
        ok: true as const,
        value: { ...REATTACH, finishedAt: '2026-10-02T10:00:00.000Z', storedRunId: null },
      })),
      readState: vi.fn(async () =>
        statusOf({ phase: 'finished', finishedAt: '2026-10-02T10:00:00.000Z' }),
      ),
    });
    render(
      <LiveRunConsole
        port={port}
        category="ASI01"
        signedIn
        reattachRunId="run-77"
        now={() => new Date('2026-10-02T11:00:00.000Z')}
      />,
    );

    expect(await screen.findByText('RUN FINISHED')).toBeVisible();
    expect(await screen.findByText(/closed without a saved result/i)).toBeVisible();
    expect(screen.queryByRole('link', { name: /open the replay/i })).not.toBeInTheDocument();
  });

  it('states a refused reattach calmly and leaves the way to a new run open', async () => {
    const port = portWith({
      reattach: vi.fn(async () => ({
        ok: false as const,
        refusal: { code: 'RUN_NOT_FOUND' as const, message: 'That run was not found.' },
      })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn reattachRunId="run-gone" />);

    expect(await screen.findByText('RUN NOT FOUND')).toBeVisible();
    expect(screen.getByText(/that run was not found/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /issue run endpoint/i })).toBeVisible();
    expect(port.readState).not.toHaveBeenCalled();
  });

  it('asks for nothing while signed out', () => {
    const port = portWith();
    render(<LiveRunConsole port={port} category="ASI01" signedIn={false} reattachRunId="run-77" />);

    expect(screen.getByRole('link', { name: /sign in/i })).toBeVisible();
    expect(port.reattach).not.toHaveBeenCalled();
  });

  it('reports the run id it issued, so the screen can put it in the URL', async () => {
    const user = userEvent.setup();
    const onRunChange = vi.fn();
    render(
      <LiveRunConsole port={portWith()} category="ASI01" signedIn onRunChange={onRunChange} />,
    );

    await issue(user);

    await waitFor(() => expect(onRunChange).toHaveBeenCalledWith('run-77'));
  });
});

describe('LiveRunConsole · a run that was ended somewhere else', () => {
  it('finds the saved result and links to the replay', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'finished', toolCalls: 2 })),
      reattach: vi.fn(async () => ({
        ok: true as const,
        value: { ...REATTACH, finishedAt: '2026-10-02T10:00:00.000Z', storedRunId: 'stored-91' },
      })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);

    expect(await screen.findByRole('link', { name: /open the replay/i })).toHaveAttribute(
      'href',
      '/runs/stored-91',
    );
  });

  it('claims nothing about the result when the lookup itself fails', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'finished', toolCalls: 2 })),
      reattach: vi.fn(async () => ({
        ok: false as const,
        refusal: { code: 'REFUSED' as const, message: 'We could not read this run just now.' },
      })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);

    expect(await screen.findByText('RUN FINISHED')).toBeVisible();
    await waitFor(() => expect(port.reattach).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/closed without a saved result/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open the replay/i })).not.toBeInTheDocument();
  });
});

/**
 * THE RUN DOCK. Once a run is active, what we have seen and the control that
 * ends the run are the two things the reader needs most, and they used to sit
 * under three long sections of setup. They now lead the run and stay pinned
 * while the setup below is read. Layout cannot be measured here (there is no
 * layout engine), so this holds down the structure that produces it: the dock
 * comes first, it is a direct child of the run column so it can stay pinned for
 * the whole of it, and the state and the END RUN control are both inside it.
 */
describe('LiveRunConsole · status and END RUN lead the active run', () => {
  const connected = () =>
    portWith({
      readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 3, steps: 8 })),
    });

  const dock = () => screen.getByRole('region', { name: /what we have actually seen/i });

  it('puts the run state before the endpoint and the setup', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={connected()} category="ASI01" signedIn />);
    await issue(user);

    const state = await findRunBar();
    const endpoint = screen.getByRole('heading', { name: /point your agent here/i });
    const setup = screen.getByRole('region', { name: /register .* client/i });
    const following = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(state.compareDocumentPosition(endpoint) & following).toBeTruthy();
    expect(state.compareDocumentPosition(setup) & following).toBeTruthy();
  });

  it('keeps the state and the END RUN control together in one pinned dock', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={connected()} category="ASI01" signedIn />);
    await issue(user);

    const button = await screen.findByRole('button', { name: /end run and judge/i });
    expect(dock()).toContainElement(runBar());
    expect(dock()).toContainElement(button);
    // Pinned below the 72px header at EVERY width, by class: sticky with a top
    // offset, and no breakpoint prefix that would switch it off on a phone.
    expect(dock().className).toMatch(/(^|\s)sticky(\s|$)/);
    expect(dock().className).toMatch(/(^|\s)top-\[/);
    // Short enough to pin: the explanatory sentences are NOT inside it.
    expect(dock()).not.toContainElement(detail());
    expect(dock().querySelectorAll('p.reading')).toHaveLength(0);
  });

  it('makes the dock a direct child of the run column, so it stays pinned for all of it', async () => {
    const user = userEvent.setup();
    const { container } = render(<LiveRunConsole port={connected()} category="ASI01" signedIn />);
    await issue(user);
    await findRunBar();

    // A sticky element only travels as far as its parent does. Nested inside its
    // own section it would un-pin the moment that section scrolled away.
    expect(dock().parentElement).toBe(container.querySelector('.panel-in'));
    expect(container.querySelector('.panel-in')).toContainElement(
      screen.getByRole('heading', { name: /give your agent its task/i }),
    );
  });

  it('draws the state once and the END RUN control once', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={connected()} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText('AGENT CONNECTED');

    expect(within(dock()).getAllByRole('status')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /end run and judge/i })).toHaveLength(1);
    expect(screen.getAllByText('AGENT CONNECTED', { selector: 'span' })).toHaveLength(1);
  });

  it('hands off to the replay from the same dock once the run is judged', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={connected()} category="ASI01" signedIn />);
    await issue(user);
    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));

    const link = await screen.findByRole('link', { name: /open the replay/i });
    expect(dock()).toContainElement(link);
  });

  it('leads a reopened run with the same dock', async () => {
    render(<LiveRunConsole port={connected()} category="ASI01" signedIn reattachRunId="run-77" />);

    const button = await screen.findByRole('button', { name: /end run and judge/i });
    expect(dock()).toContainElement(button);
  });
});

/**
 * ENDED IS NOT THE SAME AS SAVED. Finishing a run stamps it ended FIRST and
 * saves the result only after the gate and the judge have answered, which can
 * take minutes. For that whole window a run reads "finished" and has no saved
 * result. A page opened in it (a reload while judging, a second tab) used to
 * look once, find nothing, and say the run had no replay, on the ordinary path
 * of a run that was about to get one.
 */
describe('LiveRunConsole · a run that is ended but whose result is not saved yet', () => {
  const ENDED = '2026-10-02T10:00:00.000Z';
  const at = (iso: string) => () => new Date(iso);
  const SOON_AFTER = at('2026-10-02T10:00:30.000Z');
  const LONG_AFTER = at('2026-10-02T10:30:00.000Z');
  const ended = (storedRunId: string | null) => ({
    ok: true as const,
    value: { ...REATTACH, finishedAt: ENDED, storedRunId },
  });
  const finishedState = vi.fn(async () => statusOf({ phase: 'finished', finishedAt: ENDED }));

  it('does not say a run still being judged has no replay', async () => {
    const port = portWith({
      reattach: vi.fn(async () => ended(null)),
      readState: finishedState,
    });
    render(
      <LiveRunConsole
        port={port}
        category="ASI01"
        signedIn
        reattachRunId="run-77"
        now={SOON_AFTER}
      />,
    );

    expect(await screen.findByText(/its result is not saved yet/i)).toBeVisible();
    expect(screen.queryByText(/closed without a saved result/i)).not.toBeInTheDocument();
  });

  it('picks the replay up when the result is saved a moment later', async () => {
    const reattach = vi
      .fn<ConnectLiveRunPort['reattach']>()
      .mockResolvedValueOnce(ended(null))
      .mockResolvedValueOnce(ended(null))
      .mockResolvedValue(ended('stored-77'));
    const port = portWith({ reattach, readState: finishedState });
    render(
      <LiveRunConsole
        port={port}
        category="ASI01"
        signedIn
        reattachRunId="run-77"
        now={SOON_AFTER}
        pollIntervalMs={10}
      />,
    );

    expect(await screen.findByRole('link', { name: /open the replay/i })).toHaveAttribute(
      'href',
      '/runs/stored-77',
    );
  });

  it('says the run has no replay only once the judging window has passed', async () => {
    const port = portWith({
      reattach: vi.fn(async () => ended(null)),
      readState: finishedState,
    });
    render(
      <LiveRunConsole
        port={port}
        category="ASI01"
        signedIn
        reattachRunId="run-77"
        now={LONG_AFTER}
      />,
    );

    expect(await screen.findByText(/closed without a saved result/i)).toBeVisible();
    expect(screen.queryByText(/not saved yet/i)).not.toBeInTheDocument();
  });

  it('says the run is being judged while this page is the one judging it', async () => {
    const user = userEvent.setup();
    let pressed = false;
    const port = portWith({
      // The run reads finished as soon as it is claimed, long before the judge
      // answers. The finish call itself is left in flight.
      readState: vi.fn(async () =>
        pressed
          ? statusOf({ phase: 'finished', toolCalls: 2, finishedAt: ENDED })
          : statusOf({ phase: 'connected', toolCalls: 2 }),
      ),
      finish: vi.fn(() => new Promise<never>(() => {})),
      reattach: vi.fn(async () => ended(null)),
    });
    render(
      <LiveRunConsole port={port} category="ASI01" signedIn now={LONG_AFTER} pollIntervalMs={10} />,
    );
    await issue(user);
    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));
    pressed = true;

    expect(await screen.findByText(/is being judged/i)).toBeVisible();
    expect(screen.queryByText(/closed without a saved result/i)).not.toBeInTheDocument();
  });
});

/**
 * AUDIT FIXES (the /impeccable audit run before PR #167 merged).
 *
 * The pinned run bar introduced a WCAG 2.2 failure of its own: a control
 * focused by keyboard while the page was scrolled could land entirely
 * underneath it (2.4.11 Focus Not Obscured). Measured in Chromium, five of the
 * eleven controls in the run column were hidden that way. The fix is a scroll
 * margin on every focusable in the column, so a focus scroll stops short of the
 * bar. A layout engine is needed to see the effect; this pins the cause.
 */
describe('LiveRunConsole · audit fixes', () => {
  it('gives every focusable under the pinned bar room to scroll clear of it', async () => {
    const user = userEvent.setup();
    const { container } = render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);
    await findRunBar();

    expect(container.querySelector('.panel-in')?.className).toMatch(
      /\[&_:is\(a,button,\[tabindex\]\)\]:scroll-mt-/,
    );
  });

  it('announces that a run is being reopened', async () => {
    const port = portWith({ reattach: vi.fn(() => new Promise<never>(() => {})) });
    render(<LiveRunConsole port={port} category="ASI01" signedIn reattachRunId="run-77" />);

    expect(screen.getByTestId('live-reopening')).toHaveAttribute('role', 'status');
    // Written one frame after the region mounts, so it is waited for.
    await waitFor(() =>
      expect(screen.getByTestId('live-reopening')).toHaveTextContent('REOPENING RUN'),
    );
  });

  it('stops asking for a saved result once the window has passed, even if every ask fails', async () => {
    let clock = Date.parse('2026-10-02T10:00:00.000Z');
    const reattach = vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'REFUSED' as const, message: 'We could not read this run just now.' },
    }));
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'finished', toolCalls: 2 })),
      reattach,
    });
    render(
      <LiveRunConsole
        port={port}
        category="ASI01"
        signedIn
        now={() => new Date(clock)}
        pollIntervalMs={10}
      />,
    );
    await issue(user);
    await waitFor(() => expect(reattach.mock.calls.length).toBeGreaterThan(1));

    // Past the window: the asking stops, and nothing is claimed about the result.
    clock += 10 * 60_000;
    await waitFor(async () => {
      const seen = reattach.mock.calls.length;
      await new Promise((r) => setTimeout(r, 60));
      expect(reattach.mock.calls.length).toBe(seen);
    });
    expect(screen.queryByText(/closed without a saved result/i)).not.toBeInTheDocument();
  });
});

/**
 * THREE STATES THAT USED TO LEAVE THE READER STUCK.
 *
 * The goal, the endpoint and the token belong to the run that was ISSUED, and
 * the category picker above the console only decides what the NEXT run serves.
 * That is the intended behaviour, and it was invisible: change the picker with a
 * run open and the goal looked stuck. Two more states told the reader to issue a
 * new run, or plainly needed one, and drew no control to do it with.
 */
describe('LiveRunConsole · the selection and the issued run can disagree, and the screen says so', () => {
  const notice = () => screen.queryByTestId('run-selection-notice');
  const fresh = { name: /issue a fresh run/i };

  it('says nothing while the selection matches the run', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText('AWAITING AGENT');

    expect(notice()).toBeNull();
  });

  it('names the category the run serves when another one is selected, and keeps the goal', async () => {
    const user = userEvent.setup();
    const port = portWith();
    const { rerender } = render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText('AWAITING AGENT');

    rerender(<LiveRunConsole port={port} category="ASI05" signedIn />);

    expect(notice()).toHaveTextContent(/this run serves ASI01/i);
    expect(notice()).toHaveTextContent(/ASI05/);
    expect(notice()).toHaveTextContent(/task goal/i);
    // A status the reader has to notice, so it is announced, and it is a
    // neutral fact: nothing is wrong, and nothing here is a breach.
    expect(notice()?.closest('[role="status"]')).not.toBeNull();
    expect(notice()?.className ?? '').not.toMatch(/breach/);
    // The run on screen is untouched: same goal, and nothing new was issued.
    expect(screen.getByText(TICKET.taskGoal)).toBeInTheDocument();
    expect(port.start).toHaveBeenCalledTimes(1);
  });

  it('says so when only the run type differs, in the words the setup used', async () => {
    const user = userEvent.setup();
    const port = portWith();
    const { rerender } = render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText('AWAITING AGENT');

    rerender(<LiveRunConsole port={port} category="ASI01" kind="benign" signedIn />);

    expect(notice()).toHaveTextContent('ATTACK RUN');
    expect(notice()).toHaveTextContent('CONTROL RUN');
    expect(notice()).not.toHaveTextContent(/malicious|benign/);
  });

  it('lets a run nobody has connected to be released from the notice, for the new selection', async () => {
    const user = userEvent.setup();
    const port = portWith();
    const { rerender } = render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText('AWAITING AGENT');
    rerender(<LiveRunConsole port={port} category="ASI05" signedIn />);

    await user.click(within(notice()!).getByRole('button', fresh));
    await issue(user);

    expect(port.start).toHaveBeenLastCalledWith({ category: 'ASI05', kind: 'malicious' });
  });

  it('does not offer to drop a run an agent is connected to, and says to end it first', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 2 })),
    });
    const { rerender } = render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText('AGENT CONNECTED');

    rerender(<LiveRunConsole port={port} category="ASI05" signedIn />);

    expect(notice()).toHaveTextContent(/end this run/i);
    expect(screen.queryByRole('button', fresh)).not.toBeInTheDocument();
  });
});

describe('LiveRunConsole · an expired run that still holds its token is not a dead end', () => {
  const AFTER = () => new Date('2099-01-01T00:00:01.000Z');
  const fresh = { name: /issue a fresh run/i };

  it('draws the control its own sentence tells the reader to use', async () => {
    const user = userEvent.setup();
    const onRunChange = vi.fn();
    render(
      <LiveRunConsole
        port={portWith()}
        category="ASI01"
        signedIn
        now={AFTER}
        onRunChange={onRunChange}
      />,
    );
    await issue(user);
    await screen.findByText('RUN EXPIRED');

    expect(detail()).toHaveTextContent(/issue a new run/i);
    await user.click(within(detail()).getByRole('button', fresh));

    expect(screen.getByRole('button', { name: /issue run endpoint/i })).toBeVisible();
    expect(onRunChange).toHaveBeenLastCalledWith(null);
  });

  it('draws that control once, even when the selection has moved on as well', async () => {
    const user = userEvent.setup();
    const port = portWith();
    const { rerender } = render(
      <LiveRunConsole port={port} category="ASI01" signedIn now={AFTER} />,
    );
    await issue(user);
    await screen.findByText('RUN EXPIRED');

    rerender(<LiveRunConsole port={port} category="ASI05" signedIn now={AFTER} />);

    expect(screen.getAllByRole('button', fresh)).toHaveLength(1);
  });

  it('draws it once for a reopened run that expired with nobody connected', async () => {
    render(
      <LiveRunConsole
        port={portWith()}
        category="ASI01"
        signedIn
        now={AFTER}
        reattachRunId="run-77"
      />,
    );
    await screen.findByText('RUN EXPIRED');

    expect(screen.getAllByRole('button', fresh)).toHaveLength(1);
  });
});

describe('LiveRunConsole · a finished run can be followed by another without a reload', () => {
  const fresh = { name: /issue a fresh run/i };
  const dock = () => screen.getByRole('region', { name: /what we have actually seen/i });
  const connected = () =>
    portWith({ readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 3 })) });

  it('offers a fresh run beside OPEN THE REPLAY once the run is judged', async () => {
    const user = userEvent.setup();
    const onRunChange = vi.fn();
    const port = connected();
    render(<LiveRunConsole port={port} category="ASI01" signedIn onRunChange={onRunChange} />);
    await issue(user);
    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));

    expect(await within(dock()).findByRole('link', { name: /open the replay/i })).toBeVisible();
    await user.click(within(dock()).getByRole('button', fresh));

    expect(screen.getByRole('button', { name: /issue run endpoint/i })).toBeVisible();
    expect(onRunChange).toHaveBeenLastCalledWith(null);
    // Letting the finished run go ends nothing and judges nothing twice.
    expect(port.finish).toHaveBeenCalledTimes(1);
  });

  it('does not offer it while the run is open, or while it is being judged', async () => {
    const user = userEvent.setup();
    let answer: (value: { ok: true; value: LiveRunSummaryView }) => void = () => undefined;
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 3 })),
      finish: vi.fn(
        () =>
          new Promise<{ ok: true; value: LiveRunSummaryView }>((resolve) => {
            answer = resolve;
          }),
      ),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);
    const end = await screen.findByRole('button', { name: /end run and judge/i });
    expect(screen.queryByRole('button', fresh)).not.toBeInTheDocument();

    await user.click(end);
    await screen.findByRole('button', { name: /judging/i });
    expect(screen.queryByRole('button', fresh)).not.toBeInTheDocument();

    answer({ ok: true, value: SUMMARY });
    expect(await screen.findByRole('button', fresh)).toBeVisible();
  });

  it('does not offer it while a result could still arrive, so the replay link is not thrown away', async () => {
    const port = portWith({
      reattach: vi.fn(async () => ({
        ok: true as const,
        value: { ...REATTACH, finishedAt: '2026-10-02T10:00:00.000Z', storedRunId: null },
      })),
      readState: vi.fn(async () =>
        statusOf({ phase: 'finished', finishedAt: '2026-10-02T10:00:00.000Z' }),
      ),
    });
    render(
      <LiveRunConsole
        port={port}
        category="ASI01"
        signedIn
        reattachRunId="run-77"
        now={() => new Date('2026-10-02T10:00:30.000Z')}
      />,
    );

    await screen.findByText(/its result is not saved yet/i);
    expect(screen.queryByRole('button', fresh)).not.toBeInTheDocument();
  });

  it('offers it for a run that ended with no saved result', async () => {
    const port = portWith({
      reattach: vi.fn(async () => ({
        ok: true as const,
        value: { ...REATTACH, finishedAt: '2026-10-02T10:00:00.000Z', storedRunId: null },
      })),
      readState: vi.fn(async () =>
        statusOf({ phase: 'finished', finishedAt: '2026-10-02T10:00:00.000Z' }),
      ),
    });
    render(
      <LiveRunConsole
        port={port}
        category="ASI01"
        signedIn
        reattachRunId="run-77"
        now={() => new Date('2026-10-02T11:00:00.000Z')}
      />,
    );

    await screen.findByText(/closed without a saved result/i);
    expect(within(dock()).getByRole('button', fresh)).toBeVisible();
  });
});

/**
 * THE SENTENCE UNDER THE BAR FOLLOWS THE SAME PHASE AS THE BAR. Polling stops the
 * moment a run is done, so the last status read on a run this page ended is
 * still `connected`. The bar already took its phase from the finish answer; the
 * sentence used to take it from that stale read, and said the agent was still
 * calling tools beside RUN FINISHED.
 */
describe('LiveRunConsole · the sentence under the bar agrees with the bar', () => {
  const live = /your agent is calling tools/i;
  const bar = runBar;

  it('still says the agent is calling tools while it is connected', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 3 })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);

    expect(await within(bar()).findByText('AGENT CONNECTED')).toBeInTheDocument();
    expect(detail()).toHaveTextContent(live);
  });

  it('says the run is ended and saved once this page has judged it', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 3 })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);
    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));

    expect(await within(bar()).findByText('RUN FINISHED')).toBeInTheDocument();
    expect(detail()).not.toHaveTextContent(live);
    expect(detail()).toHaveTextContent(/ended, judged and saved/i);
  });

  it('says the run is being judged when the server reads it ended mid-judgement', async () => {
    const user = userEvent.setup();
    let ended = false;
    const port = portWith({
      readState: vi.fn(async () =>
        statusOf({ phase: ended ? 'finished' : 'connected', toolCalls: 3 }),
      ),
      finish: vi.fn(() => {
        ended = true;
        return new Promise<never>(() => undefined);
      }),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn pollIntervalMs={10} />);
    await issue(user);
    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));

    expect(await within(bar()).findByText('RUN FINISHED')).toBeInTheDocument();
    expect(detail()).not.toHaveTextContent(live);
    expect(detail()).toHaveTextContent(/is being judged/i);
  });
});

/**
 * A LIVE REGION HAS TO EXIST BEFORE ITS TEXT DOES. A status region that mounts
 * already holding its sentence is announced by some screen readers and silently
 * skipped by others: what they watch is a change to a region they already know
 * about. So each notice's region is rendered empty first and its content is
 * written into that same node afterwards.
 *
 * The proof is in the DOM mutations, not in a screen reader. React builds a new
 * subtree off-document and inserts it whole, so a region that mounted with its
 * text produces no mutation whose target is the region itself. A mutation that
 * adds nodes INTO the region can only mean it was already there, empty.
 */
function watchInsertions() {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(document.body, { childList: true, subtree: true });
  return {
    /** Whether content was added into this existing node. */
    insertedInto(el: Element) {
      records.push(...observer.takeRecords());
      return records.some((r) => r.target === el && r.addedNodes.length > 0);
    },
    stop: () => observer.disconnect(),
  };
}

describe('LiveRunConsole · notices are written into status regions that were already there', () => {
  it('holds an empty refusal region before issue, and writes the refusal into it', async () => {
    const user = userEvent.setup();
    const watcher = watchInsertions();
    render(
      <LiveRunConsole
        port={refusingPort(
          'ALLOWANCE_EXHAUSTED',
          'You have used the free live runs on this account.',
        )}
        category="ASI01"
        signedIn
      />,
    );

    const region = screen.getByTestId('live-refusal');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toBeEmptyDOMElement();

    await issue(user);

    await waitFor(() => expect(region).toHaveTextContent('FREE LIVE RUNS USED'));
    expect(screen.getByTestId('live-refusal')).toBe(region);
    expect(region).toHaveTextContent('You have used the free live runs on this account.');
    expect(watcher.insertedInto(region)).toBe(true);
    watcher.stop();
  });

  it('mounts the reopening region empty, then writes REOPENING RUN into it', async () => {
    const watcher = watchInsertions();
    const port = portWith({ reattach: vi.fn(() => new Promise<never>(() => {})) });
    render(<LiveRunConsole port={port} category="ASI01" signedIn reattachRunId="run-77" />);

    const region = await screen.findByTestId('live-reopening');
    expect(region).toHaveAttribute('role', 'status');
    await waitFor(() => expect(region).toHaveTextContent('REOPENING RUN'));
    // Written into the region after it mounted, not mounted with it.
    expect(watcher.insertedInto(region)).toBe(true);
    watcher.stop();
  });

  it('holds an empty selection region on a matching run, and writes the mismatch into it', async () => {
    const user = userEvent.setup();
    const port = portWith();
    const { rerender } = render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);
    await findRunBar();

    const region = screen.getByTestId('live-selection');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toBeEmptyDOMElement();

    const watcher = watchInsertions();
    rerender(<LiveRunConsole port={port} category="ASI05" signedIn />);

    await waitFor(() => expect(region).toHaveTextContent(/this run serves ASI01/i));
    expect(screen.getByTestId('live-selection')).toBe(region);
    expect(watcher.insertedInto(region)).toBe(true);
    watcher.stop();
  });

  it('empties a region again when its notice no longer applies, and keeps the node', async () => {
    const user = userEvent.setup();
    const port = portWith();
    const { rerender } = render(<LiveRunConsole port={port} category="ASI01" signedIn />);
    await issue(user);
    await findRunBar();
    const region = screen.getByTestId('live-selection');

    rerender(<LiveRunConsole port={port} category="ASI05" signedIn />);
    await waitFor(() => expect(region).toHaveTextContent(/this run serves/i));
    rerender(<LiveRunConsole port={port} category="ASI01" signedIn />);

    await waitFor(() => expect(region).toBeEmptyDOMElement());
    expect(screen.getByTestId('live-selection')).toBe(region);
  });
});

/**
 * AN EXPIRED RUN SHOWS ONLY WHAT IS STILL TRUE.
 *
 * An expired run used to keep its whole setup on screen under RUN EXPIRED: the
 * endpoint to point an agent at, the token notice, the client steps and the task
 * to hand over. Every one of those is an instruction for a run that no longer
 * accepts connections, and a reopened one went further and said an agent that
 * already holds the token keeps working, which is false once the run is dead.
 * What is left is the reading, why it reads that way, and the way on.
 */
describe('LiveRunConsole · an expired run drops the setup that can no longer be used', () => {
  const BEFORE = () => new Date('2098-12-31T23:00:00.000Z');
  const AFTER = () => new Date('2099-01-01T00:00:01.000Z');

  const expectNoDeadSetup = (container: HTMLElement) => {
    // The endpoint box.
    expect(screen.queryByText(TICKET.endpoint)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy run endpoint/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: /point your agent here/i }),
    ).not.toBeInTheDocument();
    // The token notice, in both of its forms.
    expect(screen.queryByText('RUN TOKEN')).not.toBeInTheDocument();
    expect(screen.queryByText(/RUN REOPENED/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/token is shown once|we cannot show it again/i);
    // No sentence that says the dead run still works.
    expect(container.textContent).not.toMatch(/keeps working/i);
    // The client steps and the task to hand over.
    expect(screen.queryByRole('region', { name: /register .* client/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: /give your agent its task/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(TICKET.taskGoal)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  };

  const expectTheWayOn = () => {
    expect(within(runBar()).getByText('RUN EXPIRED')).toBeInTheDocument();
    expect(detail()).toHaveTextContent(/passed its expiry before it finished/i);
    expect(detail()).toHaveTextContent(/no longer accept connections/i);
    expect(detail()).toHaveTextContent(`EXPIRED ${TICKET.expiresAt}`);
    expect(screen.getAllByRole('button', { name: /issue a fresh run/i })).toHaveLength(1);
  };

  it('for a run issued on this page, which still holds its token', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LiveRunConsole port={portWith()} category="ASI01" signedIn now={AFTER} />,
    );
    await issue(user);
    await screen.findByText('RUN EXPIRED');

    expectNoDeadSetup(container);
    expectTheWayOn();
  });

  it('for a reopened run, which never had its token here', async () => {
    const { container } = render(
      <LiveRunConsole
        port={portWith()}
        category="ASI01"
        signedIn
        now={AFTER}
        reattachRunId="run-77"
      />,
    );
    await screen.findByText('RUN EXPIRED');

    expectNoDeadSetup(container);
    expectTheWayOn();
  });

  it('still names what the dead run was serving, so two expired runs can be told apart', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn now={AFTER} />);
    await issue(user);
    await screen.findByText('RUN EXPIRED');

    expect(detail()).toHaveTextContent('SERVING ASI01');
    expect(detail()).toHaveTextContent('RUN TYPE ATTACK RUN');
  });

  // GUARD. A reopened run that has NOT expired is unchanged: its agent may well
  // still hold the token, so everything it showed before is still shown.
  it('leaves a reopened run that has not expired exactly as it was', async () => {
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 3, steps: 8 })),
    });
    render(
      <LiveRunConsole port={port} category="ASI01" signedIn now={BEFORE} reattachRunId="run-77" />,
    );
    await screen.findByText('AGENT CONNECTED');

    expect(screen.getByText(REATTACH.endpoint)).toBeVisible();
    expect(screen.getByRole('button', { name: /copy run endpoint/i })).toBeVisible();
    expect(screen.getByText(/RUN REOPENED · TOKEN NOT SHOWN/)).toBeVisible();
    expect(screen.getByText(/an agent that already holds the token keeps working/i)).toBeVisible();
    expect(screen.getByRole('region', { name: /give your agent its task/i })).toBeVisible();
    expect(screen.getByText(REATTACH.taskGoal)).toBeVisible();
    expect(screen.getByRole('button', { name: /copy task goal/i })).toBeVisible();
    expect(screen.queryByText('RUN EXPIRED')).not.toBeInTheDocument();
  });

  // GUARD. A live run issued on this page keeps its whole setup.
  it('leaves a live run issued on this page with its whole setup', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn now={BEFORE} />);
    await issue(user);
    await screen.findByText(TICKET.endpoint);

    expect(screen.getByText('RUN TOKEN')).toBeVisible();
    expect(screen.getByRole('region', { name: /register .* client/i })).toBeVisible();
    expect(screen.getByRole('region', { name: /give your agent its task/i })).toBeVisible();
  });
});
