import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectScreen } from '@/components/connect/ConnectScreen';
import { LiveRunConsole } from '@/components/connect/LiveRunConsole';
import type {
  ConnectLiveRunPort,
  LiveRunDiscardView,
  LiveRunReattachView,
  LiveRunStatusView,
  LiveRunSummaryView,
  LiveRunTicketView,
} from '@/components/connect/live-run-port';
import {
  DISCARD_CONFIRM_NO,
  DISCARD_CONFIRM_QUESTION,
  DISCARD_CONFIRM_YES,
  DISCARD_RUN_LABEL,
  RUN_DISCARDED_LABEL,
  RUN_DISCARDED_SENTENCE,
} from '@/runs/discard-copy';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

/**
 * DISCARD RUN, on the Connect screen.
 *
 * A second way to end a run, beside END RUN AND JUDGE and quieter than it: the
 * run ends, the token stops working, and nobody is asked for a verdict. jsdom
 * lays nothing out, so where the control sits at each width is measured in a
 * browser (tests/e2e/discard-run.spec.ts). What is held here is everything that
 * does not depend on layout.
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

const status = (
  phase: LiveRunStatusView['phase'],
  over: Partial<LiveRunStatusView> = {},
): LiveRunStatusView => ({
  runId: 'run-77',
  phase,
  connectedAt: null,
  lastSeenAt: null,
  steps: 9,
  toolCalls: phase === 'waiting' ? 0 : 4,
  finishedAt: null,
  ...over,
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

const DISCARDED: LiveRunDiscardView = { runId: 'run-77', steps: 9 };

const REATTACH: LiveRunReattachView = {
  runId: 'run-77',
  endpoint: TICKET.endpoint,
  expiresAt: TICKET.expiresAt,
  category: 'ASI01',
  kind: 'malicious',
  promptName: TICKET.promptName,
  taskGoal: TICKET.taskGoal,
  finishedAt: null,
  storedRunId: null,
};

type Port = Required<ConnectLiveRunPort>;

function portWith(phase: LiveRunStatusView['phase'], over: Partial<Port> = {}): Port {
  return {
    start: vi.fn(async () => ({ ok: true as const, value: TICKET })),
    readState: vi.fn(async () => ({ ok: true as const, value: status(phase) })),
    finish: vi.fn(async () => ({ ok: true as const, value: SUMMARY })),
    discard: vi.fn(async () => ({ ok: true as const, value: DISCARDED })),
    reattach: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_NOT_FOUND' as const, message: 'not found' },
    })),
    ...over,
  };
}

const dock = () => screen.getByRole('region', { name: /what we have actually seen/i });
const detail = () => screen.getByTestId('run-state-detail');
const narrow = () => screen.getByTestId('discard-run-narrow');
/** The control in the pinned bar (the wide layout). */
const trigger = () => within(dock()).getByRole('button', { name: DISCARD_RUN_LABEL });
/** The same control as a phone draws it, directly under the bar. */
const narrowTrigger = () => within(narrow()).getByRole('button', { name: DISCARD_RUN_LABEL });
const confirm = () => within(dock()).getByRole('group', { name: /discard this run/i });
const queryConfirm = () => within(dock()).queryByRole('group', { name: /discard this run/i });

async function issue(port: ConnectLiveRunPort, settle: string, props: object = {}) {
  const user = userEvent.setup();
  render(<LiveRunConsole port={port} category="ASI01" signedIn {...props} />);
  await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
  await within(dock()).findByText(settle);
  return user;
}

describe('the copy is the approved copy', () => {
  it('asks the exact question and offers the exact two answers', () => {
    expect(DISCARD_RUN_LABEL).toBe('DISCARD RUN');
    expect(DISCARD_CONFIRM_QUESTION).toBe(
      'Discard this run? It ends now, its token stops working, and it is not judged.',
    );
    expect(DISCARD_CONFIRM_YES).toBe('DISCARD');
    expect(DISCARD_CONFIRM_NO).toBe('KEEP RUNNING');
    expect(RUN_DISCARDED_LABEL).toBe('RUN DISCARDED');
  });
});

describe('where DISCARD RUN is offered', () => {
  it('sits in the pinned bar beside END RUN AND JUDGE on a connected run', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');

    expect(trigger()).toBeInTheDocument();
    expect(within(dock()).getByRole('button', { name: 'End run and judge' })).toBeInTheDocument();
  });

  it('is offered on a run nobody has connected to, where END RUN is not', async () => {
    await issue(portWith('waiting'), 'AWAITING AGENT');

    expect(trigger()).toBeInTheDocument();
    expect(within(dock()).queryByRole('button', { name: /end run/i })).not.toBeInTheDocument();
  });

  it('is the secondary control: END RUN keeps the glow and the fill, DISCARD has neither', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');
    const end = within(dock()).getByRole('button', { name: 'End run and judge' });

    expect(end.className).toMatch(/shadow-glow-nominal/);
    expect(end.className).toMatch(/bg-nominal/);
    for (const control of [trigger(), narrowTrigger()]) {
      expect(control.className).not.toMatch(/shadow-glow|bg-nominal/);
      // Not a breach, so never the breach red.
      expect(control.className).not.toMatch(/breach/);
      expect(control.className).toMatch(/\bmin-h-11\b/);
    }
  });

  it('is one control at any width: in the bar when it fits, under the bar when it does not', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');

    // The bar copy is hidden until the wide breakpoint; the other is hidden from it.
    expect(trigger().className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(trigger().className).toMatch(/\blg:inline-flex\b/);
    expect(narrow().className).toMatch(/\blg:hidden\b/);
    expect(dock()).not.toContainElement(narrow());
  });

  it('is not offered once the run has expired', async () => {
    const port = portWith('connected');
    const user = userEvent.setup();
    render(
      <LiveRunConsole
        port={{
          ...port,
          start: vi.fn(async () => ({
            ok: true as const,
            value: { ...TICKET, expiresAt: '2000-01-01T00:00:00.000Z' },
          })),
        }}
        category="ASI01"
        signedIn
      />,
    );
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    await within(dock()).findByText('RUN EXPIRED');

    expect(screen.queryByRole('button', { name: DISCARD_RUN_LABEL })).not.toBeInTheDocument();
  });

  it('is not offered once the run is finished', async () => {
    const user = await issue(portWith('connected'), 'AGENT CONNECTED');
    await user.click(within(dock()).getByRole('button', { name: 'End run and judge' }));
    await within(dock()).findByText('RUN FINISHED');

    expect(screen.queryByRole('button', { name: DISCARD_RUN_LABEL })).not.toBeInTheDocument();
  });

  it('is not offered while a judge call is in flight', async () => {
    const finish = vi.fn(() => new Promise<never>(() => {}));
    const user = await issue(portWith('connected', { finish }), 'AGENT CONNECTED');
    await user.click(within(dock()).getByRole('button', { name: 'End run and judge' }));
    await within(dock()).findByRole('button', { name: 'JUDGING' });

    expect(screen.queryByRole('button', { name: DISCARD_RUN_LABEL })).not.toBeInTheDocument();
  });

  it('is not drawn at all when nothing is wired behind it', async () => {
    const full = portWith('connected');
    const without: ConnectLiveRunPort = {
      start: full.start,
      readState: full.readState,
      finish: full.finish,
      reattach: full.reattach,
    };
    await issue(without, 'AGENT CONNECTED');

    expect(screen.queryByRole('button', { name: DISCARD_RUN_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByTestId('discard-run-narrow')).not.toBeInTheDocument();
  });

  it('says in prose what discarding is for and that it still uses a free run', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');

    const note = within(detail()).getByText(/discard the run instead/i);
    expect(note.className).toMatch(/\breading\b/);
    expect(note.textContent).toMatch(/not judged/i);
    expect(note.textContent).toMatch(/still counts toward your free live runs/i);
    // The allowance is configuration: no numeral is written into this sentence.
    expect(note.textContent).not.toMatch(/\d/);
  });
});

describe('the confirm step', () => {
  it('asks before doing anything, in the exact words', async () => {
    const port = portWith('connected');
    const user = await issue(port, 'AGENT CONNECTED');

    await user.click(trigger());

    expect(within(confirm()).getByText(DISCARD_CONFIRM_QUESTION)).toBeInTheDocument();
    expect(
      within(confirm()).getByRole('button', { name: DISCARD_CONFIRM_YES }),
    ).toBeInTheDocument();
    expect(within(confirm()).getByRole('button', { name: DISCARD_CONFIRM_NO })).toBeInTheDocument();
    expect(port.discard).not.toHaveBeenCalled();
  });

  it('sets the question as READING prose, and both answers as full-size targets', async () => {
    const user = await issue(portWith('connected'), 'AGENT CONNECTED');
    await user.click(trigger());

    const question = within(confirm()).getByText(DISCARD_CONFIRM_QUESTION);
    expect(question.className).toMatch(/\breading\b/);
    expect(question.className).not.toMatch(/micro-label|instrument|font-mono/);
    for (const name of [DISCARD_CONFIRM_YES, DISCARD_CONFIRM_NO]) {
      expect(within(confirm()).getByRole('button', { name }).className).toMatch(/\bmin-h-11\b/);
    }
    // Caution or neutral, never the breach red.
    expect(confirm().innerHTML).not.toMatch(/breach/);
  });

  it('moves focus into the confirm, onto KEEP RUNNING and not onto the destructive answer', async () => {
    const user = await issue(portWith('connected'), 'AGENT CONNECTED');
    await user.click(trigger());

    await waitFor(() =>
      expect(within(confirm()).getByRole('button', { name: DISCARD_CONFIRM_NO })).toHaveFocus(),
    );
  });

  it('marks the control as expanded while the confirm is open', async () => {
    const user = await issue(portWith('connected'), 'AGENT CONNECTED');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });

  it('KEEP RUNNING closes it, discards nothing and returns focus to the control', async () => {
    const port = portWith('connected');
    const user = await issue(port, 'AGENT CONNECTED');
    await user.click(trigger());

    await user.click(within(confirm()).getByRole('button', { name: DISCARD_CONFIRM_NO }));

    expect(queryConfirm()).not.toBeInTheDocument();
    expect(port.discard).not.toHaveBeenCalled();
    expect(within(dock()).getByText('AGENT CONNECTED')).toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('returns focus to the phone control when that is the one that opened it', async () => {
    const user = await issue(portWith('connected'), 'AGENT CONNECTED');
    await user.click(narrowTrigger());
    await user.click(within(confirm()).getByRole('button', { name: DISCARD_CONFIRM_NO }));

    await waitFor(() => expect(narrowTrigger()).toHaveFocus());
  });

  it('Escape cancels, exactly like KEEP RUNNING', async () => {
    const port = portWith('connected');
    const user = await issue(port, 'AGENT CONNECTED');
    await user.click(trigger());
    await waitFor(() =>
      expect(within(confirm()).getByRole('button', { name: DISCARD_CONFIRM_NO })).toHaveFocus(),
    );

    await user.keyboard('{Escape}');

    expect(queryConfirm()).not.toBeInTheDocument();
    expect(port.discard).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('is operable from the keyboard alone: Enter opens, Tab reaches DISCARD, Enter confirms', async () => {
    const port = portWith('connected');
    const user = await issue(port, 'AGENT CONNECTED');
    trigger().focus();

    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(within(confirm()).getByRole('button', { name: DISCARD_CONFIRM_NO })).toHaveFocus(),
    );
    await user.tab({ shift: true });
    expect(within(confirm()).getByRole('button', { name: DISCARD_CONFIRM_YES })).toHaveFocus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(port.discard).toHaveBeenCalledTimes(1));
  });

  it('closes if the run is ended and judged instead', async () => {
    const port = portWith('connected');
    const user = await issue(port, 'AGENT CONNECTED');
    await user.click(trigger());

    await user.click(within(dock()).getByRole('button', { name: 'End run and judge' }));

    await within(dock()).findByText('RUN FINISHED');
    expect(queryConfirm()).not.toBeInTheDocument();
    expect(port.discard).not.toHaveBeenCalled();
  });
});

describe('after DISCARD is confirmed', () => {
  async function discarded(port: Port = portWith('connected'), props: object = {}) {
    const user = await issue(port, 'AGENT CONNECTED', props);
    await user.click(trigger());
    await user.click(within(confirm()).getByRole('button', { name: DISCARD_CONFIRM_YES }));
    await within(dock()).findByText(RUN_DISCARDED_LABEL);
    return user;
  }

  it('discards this run by its id, once, and never asks for a verdict', async () => {
    const port = portWith('connected');
    await discarded(port);

    expect(port.discard).toHaveBeenCalledTimes(1);
    expect(port.discard).toHaveBeenCalledWith({ runId: 'run-77' });
    expect(port.finish).not.toHaveBeenCalled();
  });

  it('reads RUN DISCARDED in the bar, inert, with an icon beside the label', async () => {
    await discarded();
    const label = within(dock()).getByText(RUN_DISCARDED_LABEL);
    const region = within(dock()).getByRole('status');

    expect(region).toContainElement(label);
    expect(label.getAttribute('style')).toContain('--status-inert');
    expect(region.querySelector('svg')).not.toBeNull();
    expect(dock().innerHTML).not.toMatch(/breach/);
    expect(within(dock()).queryByText('RUN FINISHED')).not.toBeInTheDocument();
  });

  it('offers ISSUE A FRESH RUN as the one action, and moves focus to it', async () => {
    await discarded();

    const fresh = within(dock()).getByRole('button', { name: /fresh run/i });
    expect(fresh).toHaveTextContent('ISSUE A FRESH RUN');
    expect(within(dock()).getAllByRole('button')).toHaveLength(1);
    expect(within(dock()).queryByRole('link')).not.toBeInTheDocument();
    await waitFor(() => expect(fresh).toHaveFocus());
  });

  it('says in prose that the run was discarded and not judged, and offers no result', async () => {
    await discarded();

    const sentence = within(detail()).getByText(new RegExp(RUN_DISCARDED_SENTENCE));
    expect(sentence.className).toMatch(/\breading\b/);
    expect(detail().textContent).not.toMatch(/judged and saved|being judged|replay link/i);
    expect(screen.queryByRole('link', { name: /open the replay/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open the report/i })).not.toBeInTheDocument();
    expect(detail().textContent).toMatch(/still counts toward your free live runs/i);
  });

  it('drops the setup, because the token no longer works', async () => {
    await discarded();

    expect(screen.queryByText('RUN ENDPOINT')).not.toBeInTheDocument();
    expect(screen.queryByText('RUN TOKEN')).not.toBeInTheDocument();
  });

  it('stops polling, and does not go looking for a saved result', async () => {
    const port = portWith('connected');
    await discarded(port, { pollIntervalMs: 10 });
    const reads = vi.mocked(port.readState).mock.calls.length;

    await new Promise((r) => setTimeout(r, 60));

    expect(vi.mocked(port.readState).mock.calls.length).toBe(reads);
    expect(port.reattach).not.toHaveBeenCalled();
  });

  it('goes back to the issue control from ISSUE A FRESH RUN', async () => {
    const user = await discarded();

    await user.click(within(dock()).getByRole('button', { name: /fresh run/i }));

    expect(await screen.findByRole('button', { name: /issue run endpoint/i })).toBeInTheDocument();
    expect(screen.queryByText(RUN_DISCARDED_LABEL)).not.toBeInTheDocument();
  });

  it('tells the screen above, so the section is headed RUN DISCARDED and not RUN FINISHED', async () => {
    const onDiscardedChange = vi.fn();
    const onRunOver = vi.fn();
    await discarded(portWith('connected'), { onDiscardedChange, onRunOver });

    expect(onDiscardedChange).toHaveBeenLastCalledWith(true);
    // A discarded run is over: a later visit must not reopen it.
    expect(onRunOver).toHaveBeenCalledWith('run-77');
  });

  it('heads the section RUN DISCARDED on the Connect screen', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn livePort={portWith('connected')} />);
    await user.click(screen.getByRole('button', { name: /LIVE · your agent connects to us/i }));
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    await within(dock()).findByText('AGENT CONNECTED');
    await user.click(trigger());
    await user.click(within(confirm()).getByRole('button', { name: DISCARD_CONFIRM_YES }));
    await within(dock()).findByText(RUN_DISCARDED_LABEL);

    const head = document.getElementById('connect-run-head')!;
    await waitFor(() => expect(head).toHaveTextContent(RUN_DISCARDED_LABEL));
    expect(head).not.toHaveTextContent('RUN FINISHED');
  });
});

describe('while the discard is in flight, and when it is refused', () => {
  it('ignores a second DISCARD and takes END RUN away', async () => {
    let answer!: (v: { ok: true; value: LiveRunDiscardView }) => void;
    const discard = vi.fn(
      () =>
        new Promise<{ ok: true; value: LiveRunDiscardView }>((resolve) => {
          answer = resolve;
        }),
    );
    const port = portWith('connected', { discard });
    const user = await issue(port, 'AGENT CONNECTED');
    await user.click(trigger());
    const yes = within(confirm()).getByRole('button', { name: DISCARD_CONFIRM_YES });

    await user.click(yes);
    await within(dock()).findByText('DISCARDING');
    expect(within(dock()).queryByRole('button', { name: /end run/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DISCARD_RUN_LABEL })).not.toBeInTheDocument();
    expect(port.finish).not.toHaveBeenCalled();

    answer({ ok: true, value: DISCARDED });
    await within(dock()).findByText(RUN_DISCARDED_LABEL);
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it('states a refusal beside the control, in caution, and leaves the run as it was', async () => {
    const discard = vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'REFUSED' as const, message: 'We could not reach the run service.' },
    }));
    const user = await issue(portWith('connected', { discard }), 'AGENT CONNECTED');
    await user.click(trigger());
    await user.click(within(confirm()).getByRole('button', { name: DISCARD_CONFIRM_YES }));

    const alert = await within(dock()).findByRole('alert');
    expect(alert).toHaveTextContent('We could not reach the run service.');
    expect(alert.innerHTML).not.toMatch(/breach/);
    expect(within(dock()).getByText('AGENT CONNECTED')).toBeInTheDocument();
    expect(queryConfirm()).not.toBeInTheDocument();
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it('reads RUN DISCARDED when the refusal says another tab already discarded it', async () => {
    const discard = vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_DISCARDED' as const, message: RUN_DISCARDED_SENTENCE },
    }));
    const user = await issue(portWith('connected', { discard }), 'AGENT CONNECTED');
    await user.click(trigger());
    await user.click(within(confirm()).getByRole('button', { name: DISCARD_CONFIRM_YES }));

    expect(await within(dock()).findByText(RUN_DISCARDED_LABEL)).toBeInTheDocument();
    expect(within(dock()).getByRole('button', { name: /fresh run/i })).toBeInTheDocument();
  });

  it('reads RUN DISCARDED when END RUN is refused because the run was discarded elsewhere', async () => {
    const finish = vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_DISCARDED' as const, message: RUN_DISCARDED_SENTENCE },
    }));
    const user = await issue(portWith('connected', { finish }), 'AGENT CONNECTED');
    await user.click(within(dock()).getByRole('button', { name: 'End run and judge' }));

    expect(await within(dock()).findByText(RUN_DISCARDED_LABEL)).toBeInTheDocument();
    expect(within(dock()).queryByRole('button', { name: /end run/i })).not.toBeInTheDocument();
  });
});

describe('a run that was discarded somewhere else', () => {
  it('reads RUN DISCARDED from the status read, with nothing to judge or resume', async () => {
    const port = portWith('connected', {
      readState: vi.fn(async () => ({
        ok: true as const,
        value: status('finished', {
          finishedAt: '2026-10-09T10:00:00.000Z',
          discarded: true,
        }),
      })),
    });
    await issue(port, RUN_DISCARDED_LABEL);

    expect(within(dock()).queryByRole('button', { name: /end run/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DISCARD_RUN_LABEL })).not.toBeInTheDocument();
    expect(within(dock()).getByRole('button', { name: /fresh run/i })).toBeInTheDocument();
    expect(within(detail()).getByText(new RegExp(RUN_DISCARDED_SENTENCE))).toBeInTheDocument();
    expect(port.reattach).not.toHaveBeenCalled();
  });

  it('reads RUN DISCARDED on a reopened run, from the reattach read', async () => {
    const port = portWith('connected', {
      readState: vi.fn(async () => ({
        ok: true as const,
        value: status('finished', { finishedAt: '2026-10-09T10:00:00.000Z' }),
      })),
      reattach: vi.fn(async () => ({
        ok: true as const,
        value: { ...REATTACH, finishedAt: '2026-10-09T10:00:00.000Z', discarded: true },
      })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn reattachRunId="run-77" />);

    expect(await screen.findByText(RUN_DISCARDED_LABEL)).toBeInTheDocument();
    expect(dock()).toContainElement(screen.getByText(RUN_DISCARDED_LABEL));
    expect(within(dock()).getByRole('button', { name: /fresh run/i })).toBeInTheDocument();
    expect(within(detail()).queryByText(/closed without a saved result/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open the replay/i })).not.toBeInTheDocument();
  });
});
