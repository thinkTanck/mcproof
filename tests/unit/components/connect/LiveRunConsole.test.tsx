import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LiveRunConsole } from '@/components/connect/LiveRunConsole';
import type {
  ConnectLiveRunPort,
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
  expiresAt: '2026-08-05T12:00:00.000Z',
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
  requests: 0,
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

const statusOf = (over: Partial<LiveRunStatusView>) => ({
  ok: true as const,
  value: { ...WAITING, ...over },
});

function portWith(overrides: Partial<ConnectLiveRunPort> = {}): ConnectLiveRunPort {
  return {
    start: vi.fn(async () => ({ ok: true as const, value: TICKET })),
    readState: vi.fn(async () => ({ ok: true as const, value: WAITING })),
    finish: vi.fn(async () => ({ ok: true as const, value: SUMMARY })),
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
