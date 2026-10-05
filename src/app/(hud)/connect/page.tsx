import type { Metadata } from 'next';
import {
  finishLiveRun,
  getLiveRunReattach,
  getLiveRunStatus,
  startLiveRun,
} from '@/app/actions/live-run';
import {
  ConnectScreen,
  type CategoryGoals,
  type SampleRunIds,
} from '@/components/connect/ConnectScreen';
import { CategorySchema } from '@/contract';
import { SAMPLE_VERDICT_PROVENANCE } from '@/data/fixtures/sample-verdicts';
import { sampleRun } from '@/data/source';
import { buildHostedSurface } from '@/harness/server/surfaces';
import { getUser } from '@/lib/auth/user';

export const metadata: Metadata = {
  title: 'Connect / Run Setup · MCPwn',
  description:
    'Set up a red-team run: watch a recorded sample, or point your own MCP agent at an endpoint we host for a live run. The detector is fixed, blind, and locked, and the run ends either in a compromise anchored to one step or in a clean result.',
};

/**
 * Connect / Run Setup route.
 *
 * The console itself is a Client Component, so this server route resolves the
 * four things it cannot know on its own:
 *
 *   1. THE REAL SESSION. Live runs are gated; sample playback is not.
 *   2. WHICH RECORDED RUN each category plays, so the sample launch goes to the
 *      run the user actually picked rather than always to the hero one.
 *   3. WHAT THE SAMPLE IS, in the sample library's own provenance words. A
 *      constructed demonstration must never travel without that label.
 *   4. THE TASK EACH CATEGORY SERVES, for the preview under the picker. The
 *      goals live with the attack modules, which must never reach the browser,
 *      so they are read here and only the strings are handed down.
 *
 * ── THE LIVE PORT IS BOUND HERE, AND ONLY HERE ──
 *
 * The screen is coded against `ConnectLiveRunPort`
 * (`src/components/connect/live-run-port.ts`), and this route is the ONE place
 * the real server actions are attached to it. The four actions go down as
 * props; `ConnectScreen` adapts them through `createConnectLiveRunPort` and the
 * console never learns the server's shape.
 *
 * The actions are passed rather than imported by the client component because
 * `@/app/actions/live-run` is a `'use server'` module: importing it from the
 * browser bundle is not a thing, and a Server Component handing an action down
 * as a prop is how Next intends the boundary to be crossed. None of them takes a
 * `userId` — the account is read from the session on the server, so the browser
 * cannot name an account at all.
 *
 * ── THE ACTIVE RUN IS ADDRESSED BY THE URL ──
 *
 * `/connect?run=<runId>` names a run to reopen. The endpoint and token used to
 * live only in page memory, so a reload lost the run; the id in the URL is what
 * lets the console read it back from its durable row. Only the ID travels here.
 * The token is never in a URL, and the reattach read cannot produce it. The id is
 * passed down as given and validated by the action that uses it, which also
 * checks that the run belongs to the signed-in account.
 *
 * WHAT IS READ HERE IS ONLY A SEED. This route sees the URL on a full load and
 * not otherwise: a plain `/connect` link carries no id, and Back restores the
 * tree this route rendered first, without the param. So the screen also reads
 * the live URL and a per-tab stored id, and those are what bring a run back
 * after a visit to another screen.
 */
export default async function ConnectPage({
  searchParams,
}: {
  searchParams?: Promise<{ run?: string | string[] }>;
} = {}) {
  const user = await getUser();
  const { run } = (await searchParams) ?? {};
  const runId = typeof run === 'string' && run.trim().length > 0 ? run.trim() : undefined;

  const sampleRunIds: SampleRunIds = Object.fromEntries(
    CategorySchema.options.map((category) => [category, sampleRun(category).runId]),
  );

  // The same lookup the live pipeline makes when it mints a run, so the preview
  // is the sentence the endpoint will serve. Keyed by category alone because the
  // attack run and the control run share one goal (asserted in
  // tests/unit/app/connect-task-preview.test.tsx). Only the strings go down.
  const categoryGoals: CategoryGoals = Object.fromEntries(
    CategorySchema.options.map((category) => [
      category,
      buildHostedSurface(category, 'malicious').taskGoal,
    ]),
  );

  return (
    <ConnectScreen
      signedIn={user !== null}
      initialRunId={runId}
      sampleRunIds={sampleRunIds}
      categoryGoals={categoryGoals}
      sampleProvenance={SAMPLE_VERDICT_PROVENANCE}
      liveActions={{
        start: startLiveRun,
        status: getLiveRunStatus,
        finish: finishLiveRun,
        reattach: getLiveRunReattach,
      }}
    />
  );
}
