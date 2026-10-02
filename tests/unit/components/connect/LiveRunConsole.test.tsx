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

    const panel = await screen.findByRole('status');
    expect(await within(panel).findByText('AGENT CONNECTED')).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/never/i);
    expect(panel).not.toHaveTextContent('LAST SEEN');
  });

  it('omits LAST SEEN while waiting too, since no time is recorded either way', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issue(user);
    await screen.findByText(/no agent has connected yet/i);

    expect(screen.getByRole('status')).not.toHaveTextContent('LAST SEEN');
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
    expect(screen.getByRole('status')).toHaveTextContent('LAST SEEN 2026-08-05T11:31:00Z');
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
  const panel = () => screen.getByRole('status');

  it('says what the reading will change to, so AWAITING is not mistaken for broken', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn now={BEFORE} />);
    await issue(user);
    await screen.findByText(/no agent has connected yet/i);

    expect(within(panel()).getByText('AWAITING AGENT')).toBeInTheDocument();
    expect(panel()).toHaveTextContent(/changes to AGENT CONNECTED the moment your agent reaches/i);
  });

  it('moves the reading to AGENT CONNECTED once the agent is there, and drops the hint', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => statusOf({ phase: 'connected', toolCalls: 0, steps: 2 })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn now={BEFORE} />);
    await issue(user);

    expect(await within(panel()).findByText('AGENT CONNECTED')).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent(/changes to AGENT CONNECTED/i);
  });

  it('prints when the run expires, in the status panel, exactly as issued', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn now={BEFORE} />);
    await issue(user);
    await screen.findByText(/no agent has connected yet/i);

    expect(panel()).toHaveTextContent(`EXPIRES ${TICKET.expiresAt}`);
    expect(panel()).not.toHaveTextContent('RUN EXPIRED');
  });

  it('says RUN EXPIRED once the clock passes the expiry, instead of waiting for ever', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn now={AFTER} />);
    await issue(user);

    expect(await within(panel()).findByText('RUN EXPIRED')).toBeInTheDocument();
    expect(within(panel()).queryByText('AWAITING AGENT')).toBeNull();
    expect(panel()).toHaveTextContent(/no longer accept connections/i);
    expect(panel()).toHaveTextContent(/issue a new run/i);
    expect(panel()).toHaveTextContent(`EXPIRED ${TICKET.expiresAt}`);
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
    expect(screen.getByRole('status').textContent).not.toMatch(/\d/);
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
    // The run's own category, not the one the picker happens to be on.
    expect(screen.getByText('ASI01')).toBeVisible();
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
    render(<LiveRunConsole port={port} category="ASI01" signedIn reattachRunId="run-77" />);

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
