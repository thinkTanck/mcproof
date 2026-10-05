import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectScreen } from '@/components/connect/ConnectScreen';
import { ACTIVE_RUN_STORAGE_KEY } from '@/components/connect/active-run-store';
import { SAMPLE_CATEGORY } from '@/data/sample-category';

// The screen reads the run id off the LIVE URL. Outside the app router the real
// hook has no context to read, so this stands in for it with the one thing it
// reports here: the query string the browser is actually on.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// A run issued in one test must not be found by the next: the stored id and the
// URL are both browser state, and both outlive a render.
afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

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

/**
 * COMING BACK TO THE SCREEN. The id used to be read once, as a server prop, and
 * both ways back lost it: the nav link goes to plain `/connect`, and Back
 * restores the router tree the page was first rendered with, which has no
 * `?run=` in it even though the address bar does. So the screen mounted with no
 * id and opened fresh, and the reattach read was never asked for.
 *
 * The id is now taken from the live URL, and from a per-tab stored copy when the
 * URL carries none. Only the id is stored. The token never is.
 */
describe('ConnectScreen · the active run survives a trip to another screen', () => {
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

  const SUMMARY = {
    runId: 'run-1',
    storedRunId: 'stored-1',
    compromised: false,
    category: 'ASI06' as const,
    severity: 'None' as const,
    stepId: null,
    steps: 5,
  };

  const statusOf = (phase: 'waiting' | 'connected' | 'finished', toolCalls: number) => ({
    ok: true as const,
    value: {
      runId: 'run-1',
      phase,
      connectedAt: null,
      lastSeenAt: null,
      steps: 5,
      toolCalls,
      finishedAt: null,
    },
  });

  const notFound = {
    ok: false as const,
    code: 'RUN_NOT_FOUND' as const,
    message: 'That run was not found.',
  };

  const actions = (
    over: {
      status?: ReturnType<typeof statusOf>;
      reattach?: typeof notFound;
    } = {},
  ) => ({
    start: vi.fn(async () => ({
      ok: true as const,
      value: { ...VIEW, token: 'mcpwn_rt_secret' },
    })),
    status: vi.fn(async () => over.status ?? statusOf('connected', 2)),
    finish: vi.fn(async () => ({ ok: true as const, value: SUMMARY })),
    reattach: vi.fn(async () => over.reattach ?? { ok: true as const, value: VIEW }),
  });

  const stored = () => window.sessionStorage.getItem(ACTIVE_RUN_STORAGE_KEY);

  const issue = async (user: ReturnType<typeof userEvent.setup>) => {
    await goLive(user);
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    await screen.findByText('AGENT CONNECTED');
  };

  it('reopens the stored run when the URL names none, as a plain nav link leaves it', async () => {
    window.sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, 'run-1');
    const live = actions();
    render(<ConnectScreen signedIn liveActions={live} />);

    expect(await screen.findByText('AGENT CONNECTED')).toBeVisible();
    expect(screen.getByRole('button', { name: /live/i })).toHaveAttribute('aria-pressed', 'true');
    expect(live.reattach).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(live.start).not.toHaveBeenCalled();
    // The URL is put back in step, so a reload from here reopens the same run.
    await waitFor(() => expect(window.location.search).toBe('?run=run-1'));
  });

  it('reopens a run named only in the live URL, as Back leaves it', async () => {
    window.history.replaceState(null, '', '/connect?run=run-1');
    const live = actions();
    // No `initialRunId`: the restored tree was rendered without the param.
    render(<ConnectScreen signedIn liveActions={live} />);

    expect(await screen.findByText('AGENT CONNECTED')).toBeVisible();
    expect(live.reattach).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(live.start).not.toHaveBeenCalled();
  });

  it('stores the id, and never the token, when a run is issued', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn liveActions={actions()} />);
    await issue(user);

    expect(stored()).toBe('run-1');
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('mcpwn_rt_secret');
  });

  it('forgets the stored id once the run is ended, so it is not reopened later', async () => {
    const user = userEvent.setup();
    const first = render(<ConnectScreen signedIn liveActions={actions()} />);
    await issue(user);
    await user.click(screen.getByRole('button', { name: /end run and judge/i }));
    await screen.findByRole('link', { name: /open the replay/i });

    await waitFor(() => expect(stored()).toBeNull());

    // Back via the plain link: nothing is reopened.
    first.unmount();
    window.history.replaceState(null, '', '/connect');
    const later = actions();
    render(<ConnectScreen signedIn liveActions={later} />);
    expect(screen.getByRole('button', { name: /sample/i })).toHaveAttribute('aria-pressed', 'true');
    expect(later.reattach).not.toHaveBeenCalled();
  });

  it('forgets the stored id when a reopened run is let go for a fresh one', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, 'run-1');
    render(<ConnectScreen signedIn liveActions={actions({ status: statusOf('waiting', 0) })} />);

    await user.click(await screen.findByRole('button', { name: /issue a fresh run/i }));

    expect(stored()).toBeNull();
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.getByRole('button', { name: /issue run endpoint/i })).toBeVisible();
  });

  it('forgets a stored id the server no longer knows', async () => {
    window.sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, 'run-gone');
    render(<ConnectScreen signedIn liveActions={actions({ reattach: notFound })} />);

    expect(await screen.findByText('RUN NOT FOUND')).toBeVisible();
    await waitFor(() => expect(stored()).toBeNull());
  });

  it('reopens nothing from storage for a signed-out visitor', () => {
    window.sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, 'run-1');
    const live = actions();
    render(<ConnectScreen signedIn={false} liveActions={live} />);

    expect(screen.getByRole('button', { name: /sample/i })).toHaveAttribute('aria-pressed', 'true');
    expect(live.reattach).not.toHaveBeenCalled();
  });
});

/**
 * THE TASK PREVIEW. The goal a run hands the agent is decided by the category,
 * and it used to appear only at the very bottom of an issued run, four sections
 * below the picker that decides it. The preview sits directly under the picker
 * and follows the selection, so the reader sees what they are choosing.
 *
 * The goals reach the screen as a prop of plain strings, built on the server.
 * These are invented strings on purpose: the screen must print what it is
 * handed, not something it looked up for itself.
 */
describe('ConnectScreen · the task preview follows the category picker', () => {
  const GOALS = {
    ASI01: 'Goal one: read the inbox.',
    ASI02: 'Goal two: fetch the invoice.',
    ASI03: 'Goal three: look up the tier.',
    ASI04: 'Goal four: add the library.',
    ASI05: 'Goal five: convert the sheet.',
    ASI06: 'Goal six: save the instructions.',
    ASI10: 'Goal ten: review the expenses.',
  } as const;
  const CODES = Object.keys(GOALS) as (keyof typeof GOALS)[];

  const ISSUED_GOAL = 'The goal the server issued with the run.';

  const actions = () => ({
    start: vi.fn(async () => ({
      ok: true as const,
      value: {
        runId: 'run-1',
        endpoint: 'https://mcpwn.dev/api/mcp/run-1',
        token: 'mcpwn_rt_secret',
        expiresAt: '2099-01-01T00:00:00.000Z',
        category: 'ASI06' as const,
        kind: 'malicious' as const,
        taskGoal: ISSUED_GOAL,
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

  const preview = () => screen.getByRole('group', { name: /task preview/i });
  const pick = (user: ReturnType<typeof userEvent.setup>, code: string) =>
    user.click(screen.getByRole('radio', { name: new RegExp(code) }));

  it.each(CODES)(
    'shows the exact goal for %s when it is selected, with no run issued',
    async (code) => {
      const user = userEvent.setup();
      render(<ConnectScreen categoryGoals={GOALS} />);

      await pick(user, code);

      expect(preview()).toHaveTextContent(GOALS[code]);
      for (const other of CODES.filter((c) => c !== code)) {
        expect(preview()).not.toHaveTextContent(GOALS[other]);
      }
    },
  );

  it('starts on the goal of the category the picker starts on', () => {
    render(<ConnectScreen categoryGoals={GOALS} />);

    expect(preview()).toHaveTextContent(GOALS[SAMPLE_CATEGORY as keyof typeof GOALS]);
  });

  it('updates on every change of the picker, without issuing anything', async () => {
    const user = userEvent.setup();
    const live = actions();
    render(<ConnectScreen signedIn liveActions={live} categoryGoals={GOALS} />);
    await goLive(user);

    await pick(user, 'ASI01');
    expect(preview()).toHaveTextContent(GOALS.ASI01);
    await pick(user, 'ASI10');
    expect(preview()).toHaveTextContent(GOALS.ASI10);
    expect(preview()).not.toHaveTextContent(GOALS.ASI01);

    expect(live.start).not.toHaveBeenCalled();
  });

  it('sits directly under the category picker, inside the same section', () => {
    render(<ConnectScreen categoryGoals={GOALS} />);

    const picker = screen.getByRole('radiogroup', { name: /attack category/i });
    expect(picker.nextElementSibling).toBe(preview());
  });

  it('says how to get an endpoint and token, and offers nothing to copy, before a run', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn liveActions={actions()} categoryGoals={GOALS} />);
    await goLive(user);

    expect(preview()).toHaveTextContent('Issue a run to get your endpoint and token.');
    expect(preview().querySelector('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  });

  it('keeps tracking the picker after a run is issued, apart from the issued run', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn liveActions={actions()} categoryGoals={GOALS} />);
    await goLive(user);
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    const pasteStep = await screen.findByRole('region', { name: /give your agent its task/i });

    await pick(user, 'ASI01');
    expect(preview()).toHaveTextContent(GOALS.ASI01);
    await pick(user, 'ASI05');
    expect(preview()).toHaveTextContent(GOALS.ASI05);

    // The issued run keeps the goal the server gave it, whatever the picker says.
    expect(preview()).not.toHaveTextContent(ISSUED_GOAL);
    expect(pasteStep).toHaveTextContent(ISSUED_GOAL);
    expect(pasteStep).not.toHaveTextContent(GOALS.ASI05);
  });

  it('leaves the paste step as the only place the goal can be copied', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn liveActions={actions()} categoryGoals={GOALS} />);
    await goLive(user);
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    const pasteStep = await screen.findByRole('region', { name: /give your agent its task/i });

    const copyGoal = screen.getAllByRole('button', { name: /copy task goal/i });
    expect(copyGoal).toHaveLength(1);
    expect(pasteStep).toContainElement(copyGoal[0]!);
    expect(preview().querySelector('button')).toBeNull();
  });

  it('renders no preview when no goals were handed down', () => {
    render(<ConnectScreen />);

    expect(screen.queryByRole('group', { name: /task preview/i })).not.toBeInTheDocument();
  });

  // A signed-out visitor in live mode is shown the sign-in gate, not the issue
  // control, so telling them to issue a run names a step they cannot take.
  it('tells a signed-out visitor to sign in, not to issue a run they cannot issue', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn={false} categoryGoals={GOALS} />);
    await goLive(user);

    expect(preview()).toHaveTextContent('Sign in to issue a run and get your endpoint and token.');
    expect(preview()).not.toHaveTextContent('Issue a run to get your endpoint and token.');
  });
});

/**
 * THE RADIO GROUPS WORK THE WAY A RADIO GROUP DOES FROM THE KEYBOARD.
 *
 * Found by `/impeccable audit` on section 02: each option was its own tab stop
 * and the arrow keys did nothing, so the seven categories cost seven Tab presses
 * to get past and a screen reader user was told "radio, 2 of 7" by a control
 * that did not behave like one. The ARIA radio group pattern is one tab stop
 * (the checked option), with the arrow keys moving and selecting, wrapping at
 * the ends.
 */
describe('ConnectScreen · the radio groups from the keyboard', () => {
  const categories = () =>
    within(screen.getByRole('radiogroup', { name: /attack category/i })).getAllByRole('radio');
  const checked = (radios: HTMLElement[]) =>
    radios.filter((radio) => radio.getAttribute('aria-checked') === 'true');

  it('makes the category group one tab stop, on the checked option', () => {
    render(<ConnectScreen />);

    const tabStops = categories().filter((radio) => radio.tabIndex === 0);
    expect(tabStops).toHaveLength(1);
    expect(tabStops[0]).toHaveAttribute('aria-checked', 'true');
    expect(tabStops[0]).toHaveAccessibleName(new RegExp(SAMPLE_CATEGORY));
  });

  it('moves and selects with the arrow keys, in both axes', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen />);
    await user.click(screen.getByRole('radio', { name: /ASI03/ }));

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /ASI04/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /ASI04/ })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /ASI05/ })).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{ArrowUp}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: /ASI03/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /ASI03/ })).toHaveFocus();
    expect(checked(categories())).toHaveLength(1);
  });

  it('wraps at both ends, and Home and End jump to them', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen />);
    await user.click(screen.getByRole('radio', { name: /ASI01/ }));

    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('radio', { name: /ASI10/ })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /ASI01/ })).toHaveAttribute('aria-checked', 'true');

    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: /ASI10/ })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: /ASI01/ })).toHaveFocus();
    expect(screen.getByRole('radio', { name: /ASI01/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps the task preview in step with an arrow-key selection', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen categoryGoals={{ ASI01: 'First goal.', ASI02: 'Second goal.' }} />);
    await user.click(screen.getByRole('radio', { name: /ASI01/ }));

    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('group', { name: /task preview/i })).toHaveTextContent('Second goal.');
  });

  it('gives the run type group the same keys', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn />);
    await goLive(user);
    const attack = screen.getByRole('radio', { name: /attack run/i });
    const control = screen.getByRole('radio', { name: /control run/i });

    expect(attack.tabIndex).toBe(0);
    expect(control.tabIndex).toBe(-1);

    await user.click(attack);
    await user.keyboard('{ArrowDown}');
    expect(control).toHaveAttribute('aria-checked', 'true');
    expect(control).toHaveFocus();
    // The category group is a separate group: its selection did not move.
    expect(checked(categories())).toHaveLength(1);
    expect(checked(categories())[0]).toHaveAccessibleName(new RegExp(SAMPLE_CATEGORY));
  });
});

/**
 * THE SECTION HEADING DOES NOT NAME AN ENDPOINT THAT IS NOT SHOWN.
 *
 * Section 03 is headed YOUR RUN ENDPOINT. An expired run no longer draws its
 * endpoint (the run is dead, so its setup is gone), which left the heading
 * pointing at something that was not on the page. For an expired run the
 * heading says what the run bar under it says: RUN EXPIRED.
 */
describe('ConnectScreen · the section 03 heading on an expired run', () => {
  const ticket = (expiresAt: string) => ({
    runId: 'run-1',
    endpoint: 'https://mcpwn.dev/api/mcp/run-1',
    token: 'mcpwn_rt_secret',
    expiresAt,
    category: 'ASI06' as const,
    kind: 'malicious' as const,
    taskGoal: 'Do the thing.',
    promptName: 'session_brief',
  });

  const actions = (expiresAt: string) => {
    let issued = 0;
    return {
      // The first run carries the given expiry; a fresh one after it is live.
      start: vi.fn(async () => ({
        ok: true as const,
        value: ticket(issued++ === 0 ? expiresAt : '2999-01-01T00:00:00.000Z'),
      })),
      status: vi.fn(async () => ({
        ok: true as const,
        value: {
          runId: 'run-1',
          phase: 'waiting' as const,
          connectedAt: null,
          lastSeenAt: null,
          steps: 2,
          toolCalls: 0,
          finishedAt: null,
        },
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
    };
  };

  const PAST = '2000-01-01T00:00:00.000Z';
  const FUTURE = '2999-01-01T00:00:00.000Z';
  // The heading of section 03, whatever it currently says.
  const heading = () => document.getElementById('connect-run-head')!;
  const issue = async (user: ReturnType<typeof userEvent.setup>) => {
    await goLive(user);
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
  };

  it('reads RUN EXPIRED, the wording of the run bar, and names no endpoint', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn liveActions={actions(PAST)} />);
    await issue(user);
    const bar = await screen.findByRole('region', { name: /what we have actually seen/i });
    await within(bar).findByText('RUN EXPIRED');

    await waitFor(() => expect(heading()).toHaveTextContent('RUN EXPIRED'));
    expect(heading()).not.toHaveTextContent(/YOUR RUN ENDPOINT/i);
    expect(heading()).not.toHaveTextContent(/endpoint/i);
    // The same words as the bar, so the two cannot drift apart.
    expect(heading()).toHaveTextContent(within(bar).getByText('RUN EXPIRED').textContent!);
    // Still the third step of the setup.
    expect(heading()).toHaveTextContent(/^03/);
  });

  it('still reads YOUR RUN ENDPOINT for a run that has not expired', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn liveActions={actions(FUTURE)} />);
    await issue(user);
    await screen.findByText('AWAITING AGENT');

    expect(heading()).toHaveTextContent('YOUR RUN ENDPOINT');
    expect(heading()).not.toHaveTextContent('RUN EXPIRED');
  });

  it('still reads YOUR RUN ENDPOINT before any run is issued', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn liveActions={actions(PAST)} />);
    await goLive(user);

    expect(heading()).toHaveTextContent('YOUR RUN ENDPOINT');
  });

  it('goes back to YOUR RUN ENDPOINT once the expired run is let go for a fresh one', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn liveActions={actions(PAST)} />);
    await issue(user);
    await waitFor(() => expect(heading()).toHaveTextContent('RUN EXPIRED'));

    await user.click(screen.getByRole('button', { name: /issue a fresh run/i }));

    await waitFor(() => expect(heading()).toHaveTextContent('YOUR RUN ENDPOINT'));
    expect(heading()).not.toHaveTextContent('RUN EXPIRED');
  });

  it('reads RECORDED PLAYBACK in sample mode even while an expired run is held', async () => {
    const user = userEvent.setup();
    render(<ConnectScreen signedIn liveActions={actions(PAST)} />);
    await issue(user);
    await waitFor(() => expect(heading()).toHaveTextContent('RUN EXPIRED'));

    await user.click(screen.getByRole('button', { name: /SAMPLE · no sign-in/i }));

    expect(heading()).toHaveTextContent('RECORDED PLAYBACK');
  });
});
