import {
  createConnectLiveRunPort,
  notWiredLiveRunPort,
  LIVE_RUN_DISCARD_FAILED_MESSAGE,
  LIVE_RUN_UNREADABLE_STATE_MESSAGE,
  type ConnectLiveRunActions,
} from '@/components/connect/live-run-port';
import { RUN_DISCARDED_SENTENCE } from '@/runs/discard-copy';

/**
 * THE DISCARD CALL AT THE SCREEN'S ONE BOUNDARY.
 *
 * The adapter's job is distrust: a thrown call, an answer with no run id, a
 * count that is not a count each become a stated refusal, never a drawn guess.
 */

const never = async () => {
  throw new Error('not used');
};

function actions(over: Partial<ConnectLiveRunActions>): ConnectLiveRunActions {
  return { start: never, status: never, finish: never, reattach: never, ...over };
}

const STATUS = {
  runId: 'run-1',
  phase: 'finished' as const,
  connectedAt: null,
  lastSeenAt: null,
  steps: 3,
  toolCalls: 1,
  finishedAt: '2026-10-09T10:00:00.000Z',
};

const REATTACH = {
  runId: 'run-1',
  endpoint: 'https://example.invalid/api/mcp/run-1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  category: 'ASI01' as const,
  kind: 'malicious' as const,
  promptName: 'brief',
  taskGoal: 'goal',
  finishedAt: '2026-10-09T10:00:00.000Z',
  storedRunId: null,
};

describe('port.discard', () => {
  it('sends only the run id, and relays the answer', async () => {
    const discard = vi.fn(async () => ({ ok: true as const, value: { runId: 'run-1', steps: 3 } }));
    const port = createConnectLiveRunPort(actions({ discard }));

    const answer = await port.discard!({ runId: 'run-1' });

    expect(discard).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(answer).toEqual({ ok: true, value: { runId: 'run-1', steps: 3 } });
  });

  it('relays a typed refusal with its own sentence, unedited', async () => {
    const port = createConnectLiveRunPort(
      actions({
        discard: async () => ({
          ok: false as const,
          code: 'RUN_DISCARDED' as const,
          message: RUN_DISCARDED_SENTENCE,
        }),
      }),
    );

    expect(await port.discard!({ runId: 'run-1' })).toEqual({
      ok: false,
      refusal: { code: 'RUN_DISCARDED', message: RUN_DISCARDED_SENTENCE },
    });
  });

  it('turns a thrown call into a stated refusal that carries no internal detail', async () => {
    const port = createConnectLiveRunPort(
      actions({
        discard: async () => {
          throw new Error('ECONNRESET db.internal:5432');
        },
      }),
    );

    const answer = await port.discard!({ runId: 'run-1' });

    expect(answer).toEqual({
      ok: false,
      refusal: { code: 'REFUSED', message: LIVE_RUN_DISCARD_FAILED_MESSAGE },
    });
    expect(JSON.stringify(answer)).not.toContain('db.internal');
  });

  it('refuses an answer it cannot read rather than drawing it', async () => {
    for (const value of [
      { runId: '', steps: 3 },
      { runId: 'run-1', steps: -1 },
      { runId: 'run-1', steps: 1.5 },
    ]) {
      const port = createConnectLiveRunPort(
        actions({ discard: async () => ({ ok: true as const, value }) }),
      );
      expect(await port.discard!({ runId: 'run-1' })).toEqual({
        ok: false,
        refusal: { code: 'REFUSED', message: LIVE_RUN_UNREADABLE_STATE_MESSAGE },
      });
    }
  });

  it('is absent when no discard action is bound, so the screen draws no control for it', () => {
    expect(createConnectLiveRunPort(actions({})).discard).toBeUndefined();
  });

  it('refuses plainly on the not-wired port', async () => {
    const answer = await notWiredLiveRunPort.discard!({ runId: 'run-1' });

    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.refusal.code).toBe('NOT_WIRED');
  });
});

describe('the discarded flag on the two reads', () => {
  it('passes a true flag through on the status read, and nothing else as true', async () => {
    const read = async (discarded: unknown) =>
      createConnectLiveRunPort(
        actions({
          status: async () => ({ ok: true as const, value: { ...STATUS, discarded } as never }),
        }),
      ).readState({ runId: 'run-1' });

    const yes = await read(true);
    const no = await read(undefined);
    const junk = await read('yes');

    expect(yes.ok && yes.value.discarded).toBe(true);
    expect(no.ok && no.value.discarded).toBeFalsy();
    expect(junk.ok && junk.value.discarded).toBeFalsy();
  });

  it('rebuilds the reattach view with the flag, and still with no token', async () => {
    const port = createConnectLiveRunPort(
      actions({
        reattach: async () => ({
          ok: true as const,
          value: { ...REATTACH, discarded: true, token: 'rt_must_not_survive' } as never,
        }),
      }),
    );

    const answer = await port.reattach({ runId: 'run-1' });

    expect(answer.ok && answer.value.discarded).toBe(true);
    expect(JSON.stringify(answer)).not.toContain('rt_must_not_survive');
  });
});
