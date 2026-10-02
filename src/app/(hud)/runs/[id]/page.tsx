import type { Metadata } from 'next';
import { resolveRun } from '@/data/run-view';
import { Replay, ReplayEmpty } from '@/components/replay';

export const metadata: Metadata = {
  title: 'Live Attack Replay · MCPwn',
  description:
    'Replay an attack run as a live agent transcript: every step streams into the console and the detector verdict prints beside it. A run that ended in a compromise is marked at the offending step; a run the agent resisted is replayed as a clean result.',
};

/**
 * Live Attack Replay (route `/runs/[id]`, register: PRODUCT, the hero). Server
 * component: resolves the run through `resolveRun` and hands the observable
 * `RunResult` to the client Replay, along with the provenance of its verdict.
 *
 * TWO KINDS OF RUN reach this screen through one door. The sample is the no-key
 * demonstration and needs no sign-in; anything else is one of the signed-in
 * user's own PERSISTED runs, read owner-scoped through the repository port. An id
 * that is neither renders a labelled empty state. It used to fall back to the
 * sample, which would show a stranger a constructed demonstration under their own
 * run id.
 *
 * The route `id` travels into the Replay as well. It is the only id the report
 * route can resolve: a saved live run is stored under a row id, and the run id on
 * its verdict is the live session's, a different string.
 */
export default async function RunReplay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await resolveRun(id);
  if (!view) return <ReplayEmpty id={id} />;
  return <Replay run={view.run} routeId={id} provenance={view.provenance} />;
}
