import {
  createConnectLiveRunPort,
  notWiredLiveRunPort,
  LIVE_RUN_NOT_WIRED_MESSAGE,
  LIVE_RUN_UNREADABLE_STATE_MESSAGE,
  type ConnectLiveRunActions,
  type LiveRunStatusView,
  type LiveRunSummaryView,
  type LiveRunTicketView,
} from '@/components/connect/live-run-port';

/**
 * THE NARROW LOCAL PORT the Connect screen is coded against, and the ONE adapter
 * at its boundary.
 *
 * The screen needs exactly three things from the server: start a run, read that
 * run's real lifecycle state, and end it. Everything else it draws, it draws from
 * those three answers. Keeping the port that narrow is what makes the boundary a
 * boundary: the reconciliation with `@/app/actions/live-run` is the three
 * structural action types and nothing else.
 *
 * The adapter's whole job is DISTRUST. A server answer is normalized before the
 * screen ever sees it, because the alternative is a screen that renders a phase
 * it does not understand as if it did.
 */

const TICKET: LiveRunTicketView = {
  runId: 'run-1',
  endpoint: 'https://mcpwn.dev/api/mcp/run-1',
  token: `mcpwn_rt_${'a'.repeat(32)}_${'b'.repeat(64)}`,
  expiresAt: '2026-08-05T12:00:00.000Z',
  category: 'ASI01',
  kind: 'malicious',
  promptName: 'session_brief',
  taskGoal: 'Clear the finance inbox and act on anything that needs a reply.',
};

const STATUS: LiveRunStatusView = {
  runId: 'run-1',
  phase: 'connected',
  connectedAt: '2026-08-05T11:20:00.000Z',
  lastSeenAt: '2026-08-05T11:30:00.000Z',
  steps: 6,
  toolCalls: 4,
  finishedAt: null,
};

const SUMMARY: LiveRunSummaryView = {
  runId: 'run-1',
  storedRunId: 'stored-1',
  compromised: true,
  category: 'ASI01',
  severity: 'High',
  stepId: 's4',
  steps: 6,
};

/** An actions bundle whose three calls answer with whatever is given. */
function actionsWith(over: Partial<ConnectLiveRunActions> = {}): ConnectLiveRunActions {
  return {
    start: vi.fn(async () => ({ ok: true as const, value: TICKET })),
    status: vi.fn(async () => ({ ok: true as const, value: STATUS })),
    finish: vi.fn(async () => ({ ok: true as const, value: SUMMARY })),
    ...over,
  };
}

describe('the not-wired default port', () => {
  it('refuses to start, and says plainly that nothing was issued', async () => {
    const answer = await notWiredLiveRunPort.start({ category: 'ASI01' });

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.refusal.code).toBe('NOT_WIRED');
    expect(answer.refusal.message).toBe(LIVE_RUN_NOT_WIRED_MESSAGE);
  });

  it('quotes no numeral, because it is not a cost decision', () => {
    expect(LIVE_RUN_NOT_WIRED_MESSAGE).not.toMatch(/\d/);
  });

  it('refuses to read state or finish, so no phase and no result can be claimed', async () => {
    expect((await notWiredLiveRunPort.readState({ runId: 'run-1' })).ok).toBe(false);
    expect((await notWiredLiveRunPort.finish({ runId: 'run-1' })).ok).toBe(false);
  });
});

describe('the adapter · starting a run', () => {
  it('sends the chosen category, and no account, and returns the issued ticket', async () => {
    const actions = actionsWith();
    const port = createConnectLiveRunPort(actions);

    const answer = await port.start({ category: 'ASI01' });

    // The account is read from the session on the server. The browser never
    // names one, so a caller cannot start a run as somebody else.
    expect(actions.start).toHaveBeenCalledWith({ category: 'ASI01' });
    expect(JSON.stringify(vi.mocked(actions.start).mock.calls[0])).not.toContain('userId');
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.endpoint).toBe(TICKET.endpoint);
    expect(answer.value.token).toBe(TICKET.token);
    expect(answer.value.promptName).toBe('session_brief');
  });

  /**
   * THE CONTROL RUN HAS TO REACH THE SERVER. `startLiveRun` has always accepted a
   * `kind`, and the pipeline has always defaulted it to `malicious`, so a screen
   * that never sends one can only ever run the attack. The adapter is the single
   * place that could drop it, so it is asserted for BOTH wire values.
   *
   * The wire values stay `malicious` and `benign`. They are the contract's own
   * names, shared with the fixtures the detector was measured on; only the LABELS
   * a reader sees are ours to choose.
   */
  it('sends the run type the screen chose, for both wire values', async () => {
    const actions = actionsWith();
    const port = createConnectLiveRunPort(actions);

    await port.start({ category: 'ASI01', kind: 'malicious' });
    expect(actions.start).toHaveBeenCalledWith({ category: 'ASI01', kind: 'malicious' });

    await port.start({ category: 'ASI06', kind: 'benign' });
    expect(actions.start).toHaveBeenCalledWith({ category: 'ASI06', kind: 'benign' });
  });

  it('sends no run type at all when the caller named none, so the server keeps its own default', async () => {
    const actions = actionsWith();
    const port = createConnectLiveRunPort(actions);

    await port.start({ category: 'ASI01' });

    // Not `kind: undefined`: the request schema is strict, and a key we did not
    // mean to set is a claim we did not mean to make.
    expect(actions.start).toHaveBeenCalledWith({ category: 'ASI01' });
    expect(Object.keys(vi.mocked(actions.start).mock.calls[0]![0] as object)).toEqual(['category']);
  });

  it('turns the server FLAT refusal into the screen nested one, verbatim', async () => {
    const port = createConnectLiveRunPort(
      actionsWith({
        start: vi.fn(async () => ({
          ok: false as const,
          code: 'ALLOWANCE_EXHAUSTED' as const,
          message:
            'This account has reached its limit of 3 free live runs. Sample playback stays open.',
        })),
      }),
    );

    const answer = await port.start({ category: 'ASI01' });

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.refusal.code).toBe('ALLOWANCE_EXHAUSTED');
    // The count belongs to the server, which derives it from config. The screen
    // never authors it and the adapter never rewrites it.
    expect(answer.refusal.message).toContain('3 free live runs');
  });

  it('keeps an unknown refusal code readable without pretending to recognise it', async () => {
    const port = createConnectLiveRunPort(
      actionsWith({
        start: vi.fn(async () => ({
          ok: false as const,
          code: 'SOMETHING_NEW' as never,
          message: 'That run did not start.',
        })),
      }),
    );

    const answer = await port.start({ category: 'ASI01' });

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.refusal.code).toBe('REFUSED');
    expect(answer.refusal.message).toBe('That run did not start.');
  });

  it('turns a thrown action into a refusal, never an unhandled rejection', async () => {
    const port = createConnectLiveRunPort(
      actionsWith({
        start: vi.fn(async () => {
          throw new Error('network down');
        }),
      }),
    );

    const answer = await port.start({ category: 'ASI01' });

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.refusal.code).toBe('REFUSED');
    // The thrown detail is ours, not the visitor's: it never becomes copy.
    expect(answer.refusal.message).not.toContain('network down');
  });
});

describe('the adapter · reading real lifecycle state', () => {
  it('returns the phase and both counts the server actually reported', async () => {
    const port = createConnectLiveRunPort(actionsWith());

    const answer = await port.readState({ runId: 'run-1' });

    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.phase).toBe('connected');
    expect(answer.value.toolCalls).toBe(4);
    expect(answer.value.steps).toBe(6);
  });

  it('recognises exactly the three phases the server can report', async () => {
    for (const phase of ['waiting', 'connected', 'finished'] as const) {
      const port = createConnectLiveRunPort(
        actionsWith({
          status: vi.fn(async () => ({ ok: true as const, value: { ...STATUS, phase } })),
        }),
      );

      const answer = await port.readState({ runId: 'run-1' });

      expect(answer.ok).toBe(true);
      if (!answer.ok) return;
      expect(answer.value.phase).toBe(phase);
    }
  });

  it('refuses a phase it does not recognise instead of guessing one', async () => {
    const port = createConnectLiveRunPort(
      actionsWith({
        status: vi.fn(async () => ({
          ok: true as const,
          value: { ...STATUS, phase: 'recording' as never },
        })),
      }),
    );

    const answer = await port.readState({ runId: 'run-1' });

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.refusal.message).toBe(LIVE_RUN_UNREADABLE_STATE_MESSAGE);
  });

  it('refuses a count that is not a whole non-negative number', async () => {
    for (const bad of [{ steps: -1 }, { toolCalls: 1.5 }, { steps: Number.NaN }]) {
      const port = createConnectLiveRunPort(
        actionsWith({
          status: vi.fn(async () => ({ ok: true as const, value: { ...STATUS, ...bad } })),
        }),
      );

      expect((await port.readState({ runId: 'run-1' })).ok).toBe(false);
    }
  });
});

describe('the adapter · finishing a run', () => {
  it('returns the summary, carrying the stored id the replay is addressed by', async () => {
    const actions = actionsWith();
    const port = createConnectLiveRunPort(actions);

    const answer = await port.finish({ runId: 'run-1' });

    expect(actions.finish).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.value.storedRunId).toBe('stored-1');
  });

  it('refuses a summary with no stored id, rather than offering a link it cannot build', async () => {
    const port = createConnectLiveRunPort(
      actionsWith({
        finish: vi.fn(async () => ({ ok: true as const, value: { ...SUMMARY, storedRunId: '' } })),
      }),
    );

    expect((await port.finish({ runId: 'run-1' })).ok).toBe(false);
  });

  it('relays the two judge-stage refusals under their own codes', async () => {
    for (const code of ['DETECTION_FAILED', 'RESULT_INVALID'] as const) {
      const port = createConnectLiveRunPort(
        actionsWith({
          finish: vi.fn(async () => ({ ok: false as const, code, message: 'Stated plainly.' })),
        }),
      );

      const answer = await port.finish({ runId: 'run-1' });

      expect(answer.ok).toBe(false);
      if (answer.ok) return;
      expect(answer.refusal.code).toBe(code);
    }
  });
});
