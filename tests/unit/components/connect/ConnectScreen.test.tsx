import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectScreen } from '@/components/connect/ConnectScreen';
import { SAMPLE_CATEGORY } from '@/data/sample-category';

/**
 * Connect / Run Setup — the targeting console, redesigned for the inverted model
 * ([ADR-0006](docs/adr/0006-mcpwn-is-the-mcp-server.md)). The console picks ONE
 * Core-7 category, because one run serves one attack surface, and then either
 * plays that category's recorded sample or hands the live console the category
 * its endpoint will serve.
 *
 * The detector is stated BLIND · LOCKED as a FACT, never as a control that looks
 * like it might one day be switchable.
 */

const goLive = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /LIVE · your agent connects to us/i }));

describe('ConnectScreen · mode', () => {
  it('exposes SAMPLE and LIVE as aria-pressed tabs, SAMPLE selected by default', () => {
    render(<ConnectScreen />);

    expect(screen.getByRole('button', { name: /SAMPLE · no sign-in/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByRole('button', { name: /LIVE · your agent connects to us/i }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the no-sign-in distinction on the sample tab itself', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn={false} />);

    expect(screen.getByText(/sample playback needs no sign-in/i)).toBeInTheDocument();
    await goLive(user);
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/sign-in');
  });
});

describe('ConnectScreen · detector', () => {
  it('states BLIND and LOCKED as a fact, with no control implying a future toggle', () => {
    const { container } = render(<ConnectScreen />);

    expect(screen.getByText('BLIND')).toBeInTheDocument();
    expect(screen.getByText('LOCKED')).toBeInTheDocument();
    expect(screen.getByText(/never user-swappable/i)).toBeInTheDocument();
    // No disabled control anywhere: a greyed-out picker would promise a choice.
    expect(container.querySelector('[disabled]')).toBeNull();
    expect(container.querySelector('[aria-disabled="true"]')).toBeNull();
  });
});

describe('ConnectScreen · one Core-7 category per run', () => {
  const CORE7: [string, string][] = [
    ['ASI01', 'Agent Goal Hijack'],
    ['ASI02', 'Tool Misuse and Exploitation'],
    ['ASI03', 'Identity and Privilege Abuse'],
    ['ASI04', 'Agentic Supply Chain Vulnerabilities'],
    ['ASI05', 'Unexpected Code Execution (RCE)'],
    ['ASI06', 'Memory & Context Poisoning'],
    ['ASI10', 'Rogue Agents'],
  ];

  it('offers the seven categories as a single-choice radio group', () => {
    render(<ConnectScreen />);

    expect(screen.getByRole('radiogroup', { name: /attack category/i })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(7);
    for (const [id, title] of CORE7) {
      expect(
        screen.getByRole('radio', {
          name: new RegExp(`${id}.*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
        }),
      ).toBeInTheDocument();
    }
  });

  it('selects exactly one at a time, starting on the recorded sample category', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen />);

    // The default is the FEATURED sample category, tracked from its single source
    // rather than pinned to a literal, so it can never drift from the homepage hero.
    expect(screen.getByRole('radio', { name: new RegExp(SAMPLE_CATEGORY) })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('radio', { name: /ASI01/ }));
    expect(screen.getByRole('radio', { name: /ASI01/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: new RegExp(SAMPLE_CATEGORY) })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});

/**
 * THE CONTROL RUN — the other half of [ADR-0003](docs/adr/0003-core-7-scope-and-measurability-bar.md)
 * bar 4, on the screen at last.
 *
 * The pipeline has always accepted both framings and always defaulted to the
 * attack one, so every run a browser could start was the attack. Bar 4 exists
 * because without a benign control you can measure recall but never precision;
 * the same asymmetry applies to a user, whose agent could be refusing everything
 * rather than exercising judgment, with no way to tell the two apart.
 *
 * The wire values are the contract's, `malicious` and `benign`. The LABELS are
 * ours, and they must not be those two words: "benign" reads as a weaker attack
 * rather than as a run with no attack in it.
 */
describe('ConnectScreen · the control run', () => {
  const runTypeGroup = () => screen.getByRole('radiogroup', { name: /run type/i });

  it('offers an attack run and a control run, with the attack selected by default', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen />);
    await goLive(user);

    expect(runTypeGroup()).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /attack run/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /control run/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('selects one at a time, so a run is one framing', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen />);
    await goLive(user);

    await user.click(screen.getByRole('radio', { name: /control run/i }));

    expect(screen.getByRole('radio', { name: /control run/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /attack run/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('never labels the choice with our internal vocabulary', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen />);
    await goLive(user);

    expect(runTypeGroup().textContent).not.toMatch(/malicious|benign/i);
  });

  it('states tool parity plainly, and refuses the safer-sandbox reading outright', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen />);
    await goLive(user);

    expect(screen.getByText(/same tools, with the same capability/i)).toBeInTheDocument();
    expect(screen.getByText(/not a safer sandbox/i)).toBeInTheDocument();
  });

  it('says in one sentence what the control is FOR', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen />);
    await goLive(user);

    expect(screen.getByText(/nothing is trying to hijack it/i)).toBeInTheDocument();
    expect(screen.getByText(/refuses everything/i)).toBeInTheDocument();
  });

  it('keeps our own terms readable somewhere honest, without leading with them', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen />);
    await goLive(user);

    expect(screen.getByText(/malicious realization and the benign control/i)).toBeInTheDocument();
  });

  it('offers the choice only for a live run, because every recorded sample is an attack run', () => {
    render(<ConnectScreen />);

    expect(screen.queryByRole('radiogroup', { name: /run type/i })).not.toBeInTheDocument();
  });

  /**
   * The setup states tool parity and the console states what it is about to
   * serve, in nearly the same words, on the SAME screen. The signed-in axe scan
   * binds to the console's sentence, and a short match found both and proved
   * neither. This holds the phrase the scan uses to exactly one element.
   */
  it('states the console lead exactly once on the whole screen', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn />);
    await goLive(user);
    await user.click(screen.getByRole('radio', { name: /control run/i }));

    expect(
      screen.getAllByText(/We serve the same tool surface for the category you picked/i),
    ).toHaveLength(1);
  });

  it('adds no fourth numbered step to the setup sequence', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen />);
    await goLive(user);

    // The run-setup sequence is MODE, then what we serve, then the run itself.
    // The control belongs to the second of those, not to a step of its own.
    expect(screen.queryByText('04')).not.toBeInTheDocument();
  });
});

/**
 * THE WHOLE CHAIN, not the component in isolation: the screen's own state, the
 * adapter in `live-run-port`, and the `startLiveRun` action's request shape. The
 * gap this closes was precisely a chain that type-checked at every link while
 * `kind` was never sent at all.
 */
describe('ConnectScreen · the chosen run type reaches the server action', () => {
  const actions = () => ({
    start: vi.fn(async () => ({
      ok: true as const,
      value: {
        runId: 'run-1',
        endpoint: 'https://mcpwn.dev/api/mcp/run-1',
        token: 'token',
        expiresAt: '2026-08-09T12:00:00.000Z',
        category: 'ASI06' as const,
        kind: 'malicious' as const,
        taskGoal: 'Do the thing.',
        promptName: 'session_brief',
      },
    })),
    status: vi.fn(async () => ({
      ok: false as const,
      code: 'RUN_NOT_FOUND' as const,
      message: 'That run was not found.',
    })),
    finish: vi.fn(async () => ({
      ok: false as const,
      code: 'RUN_NOT_FOUND' as const,
      message: 'That run was not found.',
    })),
    reattach: vi.fn(async () => ({
      ok: false as const,
      code: 'RUN_NOT_FOUND' as const,
      message: 'That run was not found.',
    })),
  });

  const issueLive = async (user: ReturnType<typeof userEvent.setup>) => {
    await goLive(user);
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
  };

  it('sends the attack framing when the user changed nothing', async () => {
    const user = userEvent.setup();
    const live = actions();
    render(<ConnectScreen signedIn liveActions={live} />);

    await issueLive(user);

    expect(live.start).toHaveBeenCalledWith({ category: SAMPLE_CATEGORY, kind: 'malicious' });
  });

  it('sends the control framing when the control run is chosen', async () => {
    const user = userEvent.setup();
    const live = actions();
    render(<ConnectScreen signedIn liveActions={live} />);

    await goLive(user);
    await user.click(screen.getByRole('radio', { name: /control run/i }));
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));

    expect(live.start).toHaveBeenCalledWith({ category: SAMPLE_CATEGORY, kind: 'benign' });
  });

  it('sends the category and the framing together, so the two choices cannot drift apart', async () => {
    const user = userEvent.setup();
    const live = actions();
    render(<ConnectScreen signedIn liveActions={live} />);

    await goLive(user);
    await user.click(screen.getByRole('radio', { name: /ASI05/ }));
    await user.click(screen.getByRole('radio', { name: /control run/i }));
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));

    expect(live.start).toHaveBeenCalledWith({ category: 'ASI05', kind: 'benign' });
  });
});

describe('ConnectScreen · sample mode', () => {
  it('plays the recorded run for the chosen category', async () => {
    const user = userEvent.setup();
    render(
      <ConnectScreen
        sampleRunIds={{ [SAMPLE_CATEGORY]: 'sample-featured', ASI01: 'sample-asi01' }}
      />,
    );

    // The default play link resolves the FEATURED category's recorded run.
    expect(screen.getByRole('link', { name: /play sample run/i })).toHaveAttribute(
      'href',
      '/runs/sample-featured',
    );
    await user.click(screen.getByRole('radio', { name: /ASI01/ }));
    expect(screen.getByRole('link', { name: /play sample run/i })).toHaveAttribute(
      'href',
      '/runs/sample-asi01',
    );
  });

  it('falls back to the canonical sample route when no id was resolved', () => {
    render(<ConnectScreen />);

    expect(screen.getByRole('link', { name: /play sample run/i })).toHaveAttribute(
      'href',
      '/runs/sample',
    );
  });

  it('labels the sample as a constructed demonstration rather than a captured run', () => {
    render(<ConnectScreen sampleProvenance="constructed demonstration · recorded verdict" />);

    expect(screen.getByText('constructed demonstration · recorded verdict')).toBeInTheDocument();
  });

  it('offers no model picker, because a recording has one model and it is not a choice', () => {
    render(<ConnectScreen />);

    expect(screen.queryByRole('radiogroup', { name: /demo agent/i })).not.toBeInTheDocument();
  });
});

describe('ConnectScreen · the retired outbound model is gone', () => {
  it('asks for no agent endpoint and no API key in either mode', async () => {
    const user = userEvent.setup();
    const { container } = render(<ConnectScreen signedIn />);

    await goLive(user);

    expect(screen.queryByLabelText(/mcp endpoint/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).not.toMatch(/never stored/i);
    expect(container.textContent).not.toMatch(/coming soon/i);
  });
});

/**
 * THE RUN LIVES IN THE URL. The endpoint and token used to exist only in page
 * memory, so a reload or a trip to another screen lost the run. The run id now
 * rides in `?run=`, and a screen opened with one goes straight to the live
 * console and reopens that run. The token is never part of the URL.
 */
describe('ConnectScreen · the active run is addressed by the URL', () => {
  const VIEW = {
    runId: 'run-1',
    endpoint: 'https://mcpwn.dev/api/mcp/run-1',
    expiresAt: '2099-01-01T00:00:00.000Z',
    category: 'ASI06' as const,
    kind: 'malicious' as const,
    taskGoal: 'Do the thing.',
    promptName: 'session_brief',
    finishedAt: null,
    storedRunId: null,
  };

  const actions = () => ({
    start: vi.fn(async () => ({
      ok: true as const,
      value: { ...VIEW, token: 'mcpwn_rt_secret' },
    })),
    status: vi.fn(async () => ({
      ok: true as const,
      value: {
        runId: 'run-1',
        phase: 'connected' as const,
        connectedAt: null,
        lastSeenAt: null,
        steps: 5,
        toolCalls: 2,
        finishedAt: null,
      },
    })),
    finish: vi.fn(async () => ({
      ok: false as const,
      code: 'RUN_NOT_FOUND' as const,
      message: 'That run was not found.',
    })),
    reattach: vi.fn(async () => ({ ok: true as const, value: VIEW })),
  });

  afterEach(() => window.history.replaceState(null, '', '/'));

  it('opens in live mode and reopens the run named in the URL', async () => {
    const live = actions();
    render(<ConnectScreen signedIn liveActions={live} initialRunId="run-1" />);

    expect(screen.getByRole('button', { name: /live/i })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('AGENT CONNECTED')).toBeVisible();
    expect(screen.getByRole('button', { name: /end run and judge/i })).toBeVisible();
    expect(live.reattach).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(live.start).not.toHaveBeenCalled();
  });

  it('puts the run id, and never the token, in the URL once a run is issued', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn liveActions={actions()} />);
    await goLive(user);
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));

    await waitFor(() => expect(window.location.search).toBe('?run=run-1'));
    expect(window.location.href).not.toContain('mcpwn_rt_secret');
  });

  it('keeps the run across a switch to SAMPLE and back', async () => {
    const user = userEvent.setup();
    const live = actions();
    render(<ConnectScreen signedIn liveActions={live} />);
    await goLive(user);
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    await screen.findByText('AGENT CONNECTED');

    await user.click(screen.getByRole('button', { name: /sample/i }));
    await goLive(user);

    expect(await screen.findByText('AGENT CONNECTED')).toBeVisible();
    expect(live.reattach).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(live.start).toHaveBeenCalledTimes(1);
  });
});
