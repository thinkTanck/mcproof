import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectScreen } from '@/components/connect/ConnectScreen';
import { LiveRunConsole } from '@/components/connect/LiveRunConsole';
import type {
  ConnectLiveRunPort,
  LiveRunReattachView,
  LiveRunStatusView,
  LiveRunSummaryView,
  LiveRunTicketView,
} from '@/components/connect/live-run-port';

/**
 * A FINISHED RUN SHOWS ITS RESULT, NOT ITS SETUP (sweep 2026-10-07, C2).
 *
 * After END RUN AND JUDGE the bar read RUN FINISHED, "ended, judged and saved",
 * while the section under it was still headed YOUR RUN ENDPOINT and still drew
 * "Point your agent here.", the endpoint, the token ("it dies when the run
 * ends"), the client steps and CHECK IT TOOK, which waits on AGENT CONNECTED.
 * Every one of those is an instruction for a token that ending the run revoked.
 * #180 removed the same setup from an EXPIRED run; this is the finished half.
 *
 * What a finished run shows instead: the reading, why the setup is gone, what it
 * served, and where its result is.
 */

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams(),
}));

const TICKET: LiveRunTicketView = {
  runId: 'run-77',
  endpoint: 'https://mcproof.dev/api/mcp/run-77',
  token: `rt_${'a'.repeat(32)}_${'b'.repeat(64)}`,
  expiresAt: '2099-01-01T00:00:00.000Z',
  category: 'ASI01',
  kind: 'malicious',
  promptName: 'session_brief',
  taskGoal: 'Clear the finance inbox and act on anything that needs a reply.',
};

const CONNECTED: LiveRunStatusView = {
  runId: 'run-77',
  phase: 'connected',
  connectedAt: null,
  lastSeenAt: null,
  steps: 9,
  toolCalls: 4,
  finishedAt: null,
};

const COMPROMISED: LiveRunSummaryView = {
  runId: 'run-77',
  storedRunId: '3f2b6c1e-8a4d-4c1b-9e57-0a1b2c3d4e5f',
  compromised: true,
  category: 'ASI01',
  severity: 'High',
  stepId: 's4',
  steps: 9,
};

const RESISTED: LiveRunSummaryView = {
  ...COMPROMISED,
  compromised: false,
  severity: 'None',
  stepId: null,
};

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

const NOW = () => new Date('2098-06-01T12:00:00.000Z');

function portWith(overrides: Partial<ConnectLiveRunPort> = {}): ConnectLiveRunPort {
  return {
    start: vi.fn(async () => ({ ok: true as const, value: TICKET })),
    readState: vi.fn(async () => ({ ok: true as const, value: CONNECTED })),
    finish: vi.fn(async () => ({ ok: true as const, value: COMPROMISED })),
    reattach: vi.fn(async () => ({ ok: true as const, value: REATTACH })),
    ...overrides,
  };
}

const dock = () => screen.getByRole('region', { name: /what we have actually seen/i });
const runBar = () => within(dock()).getByRole('status');
const detail = () => screen.getByTestId('run-state-detail');
const result = () => screen.getByRole('region', { name: 'See the result.' });

/** Issue a run on this page, let the agent connect, then end and judge it. */
async function finishHere(port: ConnectLiveRunPort) {
  const user = userEvent.setup();
  const view = render(<LiveRunConsole port={port} category="ASI01" signedIn now={NOW} />);
  await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
  await user.click(await screen.findByRole('button', { name: /end run and judge/i }));
  await within(dock()).findByText('RUN FINISHED');
  return { user, ...view };
}

/** Open a run by id that was already ended somewhere else. */
async function reopenFinished(reattach: Partial<LiveRunReattachView>) {
  const port = portWith({
    readState: vi.fn(async () => ({
      ok: true as const,
      value: { ...CONNECTED, phase: 'finished' as const },
    })),
    reattach: vi.fn(async () => ({ ok: true as const, value: { ...REATTACH, ...reattach } })),
  });
  const view = render(
    <LiveRunConsole port={port} category="ASI01" signedIn now={NOW} reattachRunId="run-77" />,
  );
  await within(
    await screen.findByRole('region', { name: /what we have actually seen/i }),
  ).findByText('RUN FINISHED');
  return view;
}

/** Nothing that tells the reader to connect an agent to a run that is over. */
function expectNoDeadSetup(container: HTMLElement) {
  // The endpoint box.
  expect(screen.queryByText(TICKET.endpoint)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /copy run endpoint/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: /point your agent here/i })).not.toBeInTheDocument();
  // The token, in both of its forms.
  expect(screen.queryByText('RUN TOKEN')).not.toBeInTheDocument();
  expect(screen.queryByText(/RUN REOPENED/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /reveal run token/i })).not.toBeInTheDocument();
  expect(container.textContent).not.toMatch(/token is shown once|we cannot show it again/i);
  expect(container.textContent).not.toMatch(/keeps working/i);
  // The client steps, the six client tabs and the connection check.
  expect(screen.queryByRole('region', { name: /register .* client/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'MCP client' })).not.toBeInTheDocument();
  for (const tab of [
    /^CLAUDE CODE/,
    /^GITHUB COPILOT \/ VS CODE/,
    /^CURSOR/,
    /^CODEX/,
    /^GEMINI CLI/,
    /^OTHER AGENT/,
  ]) {
    expect(screen.queryByRole('button', { name: tab })).not.toBeInTheDocument();
  }
  expect(screen.queryByTestId('chat-apps-line')).not.toBeInTheDocument();
  expect(screen.queryByText('ATTACH NOTHING ELSE')).not.toBeInTheDocument();
  expect(screen.queryByText('CHECK IT TOOK')).not.toBeInTheDocument();
  expect(container.textContent).not.toMatch(/AWAITING AGENT/);
  // The task to hand over.
  expect(
    screen.queryByRole('region', { name: /give your agent its task/i }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(TICKET.taskGoal)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
}

const SETUP_GONE =
  "Ending a run revokes its token, so this run's endpoint no longer accepts connections.";
const WAY_ON = 'Issue a fresh run to test again.';
const RESULT_BODY =
  'The replay walks through every step that was recorded. The report states the verdict and what it rests on.';

describe('LiveRunConsole · a finished run drops the setup for its revoked token', () => {
  it('for a run ended on this page: no endpoint, token, client tabs, check or task', async () => {
    const { container } = await finishHere(portWith());

    expectNoDeadSetup(container);
  });

  it('for a run that was ended elsewhere and reopened here', async () => {
    const { container } = await reopenFinished({
      finishedAt: '2098-06-01T11:00:00.000Z',
      storedRunId: COMPROMISED.storedRunId,
    });

    expectNoDeadSetup(container);
  });
});

describe('LiveRunConsole · what a finished run says in place of its setup', () => {
  it('agrees with the bar and says why the setup is gone, in the proposed words', async () => {
    await finishHere(portWith());

    expect(within(runBar()).getByText('RUN FINISHED')).toBeVisible();
    expect(detail()).toHaveTextContent(
      'This run is ended, judged and saved. The replay has the whole trace.',
    );
    expect(detail()).toHaveTextContent(SETUP_GONE);
    expect(detail()).toHaveTextContent(WAY_ON);
    // Nothing under a finished bar speaks of a run that is still open.
    expect(detail()).not.toHaveTextContent(/when your agent is done, end the run/i);
    expect(detail()).not.toHaveTextContent(/no longer accept connections\. Issue a new run/i);
    expect(document.body.textContent).not.toMatch(/—/);
  });

  it('still names what the run served, and no longer prints an expiry for a revoked token', async () => {
    await finishHere(portWith());

    expect(detail()).toHaveTextContent('SERVING ASI01');
    expect(detail()).toHaveTextContent('RUN TYPE ATTACK RUN');
    expect(detail()).not.toHaveTextContent(/EXPIRES|EXPIRED/);
  });

  it('points at the result: replay and report, both for this run', async () => {
    await finishHere(portWith());

    expect(
      within(result()).getByRole('heading', { level: 3, name: 'See the result.' }),
    ).toBeVisible();
    expect(result()).toHaveTextContent(RESULT_BODY);
    expect(within(result()).getByRole('link', { name: 'Open the replay' })).toHaveAttribute(
      'href',
      `/runs/${COMPROMISED.storedRunId}`,
    );
    expect(within(result()).getByRole('link', { name: 'Open the report' })).toHaveAttribute(
      'href',
      `/findings/${COMPROMISED.storedRunId}`,
    );
    // The bar keeps its own shortcut to the replay and the one fresh-run control.
    expect(within(dock()).getByRole('link', { name: /open the replay/i })).toHaveAttribute(
      'href',
      `/runs/${COMPROMISED.storedRunId}`,
    );
    expect(screen.getAllByRole('button', { name: /fresh run/i })).toHaveLength(1);
  });

  it('reads the same for a run the agent resisted: no verdict is stated here', async () => {
    const compromised = await finishHere(portWith());
    const said = [detail().textContent, result().textContent];
    compromised.unmount();

    await finishHere(
      portWith({ finish: vi.fn(async () => ({ ok: true as const, value: RESISTED })) }),
    );

    expect([detail().textContent, result().textContent]).toEqual(said);
    expect(document.body.textContent).not.toMatch(/compromised|resisted|breach|clean run/i);
  });

  it('links a run that was ended elsewhere to its saved result', async () => {
    await reopenFinished({
      finishedAt: '2098-06-01T11:00:00.000Z',
      storedRunId: COMPROMISED.storedRunId,
    });

    expect(detail()).toHaveTextContent(SETUP_GONE);
    expect(within(result()).getByRole('link', { name: 'Open the report' })).toHaveAttribute(
      'href',
      `/findings/${COMPROMISED.storedRunId}`,
    );
  });
});

describe('LiveRunConsole · a finished run whose result is not in yet, or never came', () => {
  it('still being judged: no setup, no links to a result that is not saved, no fresh run yet', async () => {
    // Ended two minutes ago and nothing saved: inside the window a result can still arrive.
    const { container } = await reopenFinished({
      finishedAt: '2098-06-01T11:58:00.000Z',
      storedRunId: null,
    });
    await waitFor(() => expect(detail()).toHaveTextContent(/its result is not saved yet/i));

    expectNoDeadSetup(container);
    expect(detail()).toHaveTextContent(SETUP_GONE);
    expect(screen.queryByRole('region', { name: 'See the result.' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /open the (replay|report)/i }),
    ).not.toBeInTheDocument();
    // Letting the run go now would drop the only route to its replay link.
    expect(detail()).not.toHaveTextContent(WAY_ON);
    expect(screen.queryByRole('button', { name: /fresh run/i })).not.toBeInTheDocument();
  });

  it('closed with nothing saved: no setup, no links, and the way on is a fresh run', async () => {
    const { container } = await reopenFinished({
      finishedAt: '2098-06-01T09:00:00.000Z',
      storedRunId: null,
    });
    await waitFor(() =>
      expect(detail()).toHaveTextContent(/closed without a saved result, so it has no replay/i),
    );

    expectNoDeadSetup(container);
    expect(screen.queryByRole('region', { name: 'See the result.' })).not.toBeInTheDocument();
    expect(detail()).toHaveTextContent(WAY_ON);
    expect(screen.getAllByRole('button', { name: /fresh run/i })).toHaveLength(1);
  });
});

describe('LiveRunConsole · a result that arrives while the page is open', () => {
  it('goes from being judged to saved without a reload, and the result section appears', async () => {
    // The server stamps a run ended BEFORE the judge has answered, so the poll
    // can report it finished while this page's own finish call is still out.
    let answer!: (value: { ok: true; value: LiveRunSummaryView }) => void;
    let ended = false;
    const port = portWith({
      readState: vi.fn(async () => ({
        ok: true as const,
        value: ended ? { ...CONNECTED, phase: 'finished' as const } : CONNECTED,
      })),
      finish: vi.fn(() => {
        ended = true;
        return new Promise<{ ok: true; value: LiveRunSummaryView }>((resolve) => {
          answer = resolve;
        });
      }),
    });
    const user = userEvent.setup();
    const { container } = render(
      <LiveRunConsole port={port} category="ASI01" signedIn now={NOW} pollIntervalMs={20} />,
    );
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));

    // JUDGING: finished in the bar, the setup already gone, nothing to link to yet.
    await within(dock()).findByText('RUN FINISHED');
    expect(detail()).toHaveTextContent(/is ended and is being judged/i);
    expect(detail()).toHaveTextContent(SETUP_GONE);
    expectNoDeadSetup(container);
    expect(screen.queryByRole('region', { name: 'See the result.' })).not.toBeInTheDocument();
    expect(detail()).not.toHaveTextContent(WAY_ON);
    expect(screen.queryByRole('button', { name: /fresh run/i })).not.toBeInTheDocument();

    // SAVED: the judge answers, and the same page now points at the result.
    answer({ ok: true, value: COMPROMISED });

    expect(await screen.findByRole('region', { name: 'See the result.' })).toBeVisible();
    expect(detail()).toHaveTextContent(/ended, judged and saved/i);
    expect(within(result()).getByRole('link', { name: 'Open the replay' })).toHaveAttribute(
      'href',
      `/runs/${COMPROMISED.storedRunId}`,
    );
    expect(within(result()).getByRole('link', { name: 'Open the report' })).toHaveAttribute(
      'href',
      `/findings/${COMPROMISED.storedRunId}`,
    );
    expect(detail()).toHaveTextContent(WAY_ON);
    expect(screen.getAllByRole('button', { name: /fresh run/i })).toHaveLength(1);
  });
});

describe('LiveRunConsole · the selection notice on an expired run', () => {
  it('does not speak of an endpoint, token or task goal that is no longer on the page', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => ({
        ok: true as const,
        value: { ...CONNECTED, phase: 'waiting' as const, toolCalls: 0, steps: 2 },
      })),
    });
    const AFTER = () => new Date('2099-01-01T00:00:01.000Z');
    const { rerender } = render(
      <LiveRunConsole port={port} category="ASI01" signedIn now={AFTER} />,
    );
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    await within(dock()).findByText('RUN EXPIRED');

    rerender(<LiveRunConsole port={port} category="ASI05" signedIn now={AFTER} />);
    const notice = await screen.findByTestId('run-selection-notice');

    expect(notice).toHaveTextContent('This run served ASI01 (ATTACK RUN).');
    expect(notice).toHaveTextContent('You now have ASI05 (ATTACK RUN) selected above.');
    expect(notice).toHaveTextContent('A new selection takes effect on the next run you issue.');
    expect(notice).not.toHaveTextContent(/endpoint|token|task goal|on this page/i);
  });
});

describe('LiveRunConsole · the selection notice on a finished run', () => {
  it('does not speak of an endpoint, token or task goal that is no longer on the page', async () => {
    const user = userEvent.setup();
    const port = portWith();
    const { rerender } = render(<LiveRunConsole port={port} category="ASI01" signedIn now={NOW} />);
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));
    await within(dock()).findByText('RUN FINISHED');

    rerender(<LiveRunConsole port={port} category="ASI05" signedIn now={NOW} />);
    const notice = await screen.findByTestId('run-selection-notice');

    expect(notice).toHaveTextContent('This run served ASI01 (ATTACK RUN).');
    expect(notice).toHaveTextContent('You now have ASI05 (ATTACK RUN) selected above.');
    expect(notice).toHaveTextContent('A new selection takes effect on the next run you issue.');
    expect(notice).not.toHaveTextContent(/endpoint|token|task goal|on this page/i);
  });
});

describe('LiveRunConsole · guards: the other states are unchanged', () => {
  const expectFullSetup = () => {
    expect(screen.getByText(TICKET.endpoint)).toBeVisible();
    expect(screen.getByRole('button', { name: /copy run endpoint/i })).toBeVisible();
    expect(screen.getByText('RUN TOKEN')).toBeVisible();
    expect(screen.getByRole('region', { name: /register .* client/i })).toBeVisible();
    expect(screen.getByRole('group', { name: 'MCP client' })).toBeVisible();
    expect(screen.getByTestId('chat-apps-line')).toBeVisible();
    expect(screen.getByRole('region', { name: /give your agent its task/i })).toBeVisible();
    expect(screen.getByText(TICKET.taskGoal)).toBeVisible();
    expect(screen.queryByRole('region', { name: 'See the result.' })).not.toBeInTheDocument();
    expect(detail()).not.toHaveTextContent(SETUP_GONE);
    expect(detail()).toHaveTextContent(`EXPIRES ${TICKET.expiresAt}`);
  };

  it('an awaiting run still shows its whole setup', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => ({
        ok: true as const,
        value: { ...CONNECTED, phase: 'waiting' as const, toolCalls: 0, steps: 2 },
      })),
    });
    render(<LiveRunConsole port={port} category="ASI01" signedIn now={NOW} />);
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    await within(dock()).findByText('AWAITING AGENT');

    expectFullSetup();
  });

  it('a connected run still shows its whole setup, and how to end it', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn now={NOW} />);
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    await within(dock()).findByText('AGENT CONNECTED');

    expectFullSetup();
    expect(detail()).toHaveTextContent(/when your agent is done, end the run/i);
  });

  it('an expired run is exactly as #180 left it, with no result section', async () => {
    const user = userEvent.setup();
    const port = portWith({
      readState: vi.fn(async () => ({
        ok: true as const,
        value: { ...CONNECTED, phase: 'waiting' as const, toolCalls: 0, steps: 2 },
      })),
    });
    render(
      <LiveRunConsole
        port={port}
        category="ASI01"
        signedIn
        now={() => new Date('2099-01-01T00:00:01.000Z')}
      />,
    );
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    await within(dock()).findByText('RUN EXPIRED');

    expect(detail()).toHaveTextContent(
      'This run passed its expiry before it finished, so its endpoint and token no longer accept connections. Issue a new run to try again.',
    );
    expect(detail()).toHaveTextContent('SERVING ASI01');
    expect(detail()).toHaveTextContent(`EXPIRED ${TICKET.expiresAt}`);
    expect(detail()).not.toHaveTextContent(SETUP_GONE);
    expect(screen.queryByRole('region', { name: 'See the result.' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /issue a fresh run/i })).toHaveLength(1);
  });
});

describe('ConnectScreen · the section 03 heading on a finished run', () => {
  const heading = () => document.getElementById('connect-run-head')!;

  it('reads RUN FINISHED, the wording of the run bar, and names no endpoint', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn livePort={portWith()} />);
    await user.click(screen.getByRole('button', { name: /^LIVE/ }));
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    expect(heading()).toHaveTextContent('YOUR RUN ENDPOINT');

    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));
    const label = await within(dock()).findByText('RUN FINISHED');

    await waitFor(() => expect(heading()).toHaveTextContent('RUN FINISHED'));
    expect(heading()).not.toHaveTextContent(/endpoint/i);
    expect(heading()).toHaveTextContent(label.textContent!);
    expect(heading()).toHaveTextContent(/^03/);
  });

  it('goes back to YOUR RUN ENDPOINT once a fresh run is asked for', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn livePort={portWith()} />);
    await user.click(screen.getByRole('button', { name: /^LIVE/ }));
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    await user.click(await screen.findByRole('button', { name: /end run and judge/i }));
    await waitFor(() => expect(heading()).toHaveTextContent('RUN FINISHED'));

    await user.click(within(dock()).getByRole('button', { name: /fresh run/i }));

    await waitFor(() => expect(heading()).toHaveTextContent('YOUR RUN ENDPOINT'));
  });
});
