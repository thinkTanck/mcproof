'use client';

import { useMemo } from 'react';
import { ConnectScreen } from '@/components/connect/ConnectScreen';
import type { ConnectLiveRunPort, LiveRunPhase } from '@/components/connect/live-run-port';

/**
 * The real Connect screen over a FAKE live-run port, for browser tests only.
 *
 * Everything here is invented: the endpoint is on `example.invalid`, the token
 * is a labelled placeholder, and no call leaves the page. It exists so a test can
 * reach run states CI cannot produce for real (a connected agent, a judged run),
 * and it is reachable only in a build made with E2E_FIXTURES=1 (see
 * `src/config/e2e-fixtures.ts`).
 *
 * `state` picks what the fake server reports:
 *   waiting    a run nobody has connected to (the default)
 *   connected  an agent is connected and calling tools; END RUN AND JUDGE then
 *              returns a saved result, which is how a test reaches FINISHED
 *   expired    a run whose expiry has already passed
 */
export function ConnectStatesFixture({ state }: { state: string }) {
  const phase: LiveRunPhase = state === 'connected' ? 'connected' : 'waiting';
  const expiresAt = state === 'expired' ? '2000-01-01T00:00:00.000Z' : '2999-01-01T00:00:00.000Z';

  const port = useMemo<ConnectLiveRunPort>(
    () => ({
      start: async ({ category, kind }) => ({
        ok: true as const,
        value: {
          runId: 'fixture-run',
          endpoint: 'https://example.invalid/api/mcp/fixture-run',
          token: 'fixture-token-not-a-credential',
          expiresAt,
          category,
          kind: kind ?? 'malicious',
          promptName: 'fixture_brief',
          taskGoal: 'Fixture task goal. This page is a browser-test fixture.',
        },
      }),
      readState: async () => ({
        ok: true as const,
        value: {
          runId: 'fixture-run',
          phase,
          connectedAt: null,
          lastSeenAt: null,
          steps: phase === 'connected' ? 9 : 2,
          toolCalls: phase === 'connected' ? 4 : 0,
          finishedAt: null,
        },
      }),
      finish: async () => ({
        ok: true as const,
        value: {
          runId: 'fixture-run',
          storedRunId: 'fixture-stored-run',
          compromised: false,
          category: 'ASI01' as const,
          severity: 'None' as const,
          stepId: null,
          steps: 9,
        },
      }),
      reattach: async () => ({
        ok: false as const,
        refusal: { code: 'RUN_NOT_FOUND' as const, message: 'Fixture runs cannot be reopened.' },
      }),
    }),
    [phase, expiresAt],
  );

  return <ConnectScreen signedIn livePort={port} />;
}
