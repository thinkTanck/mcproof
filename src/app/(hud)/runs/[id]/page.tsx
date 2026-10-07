import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveRun } from '@/data/run-view';
import { Replay, RUN_NOT_FOUND_TITLE } from '@/components/replay';

const PAGE_METADATA: Metadata = {
  title: 'Live Attack Replay · MCPwn',
  description:
    'Replay an attack run as a live agent transcript: every step streams into the console and the detector verdict prints beside it. A run that ended in a compromise is marked at the offending step; a run the agent resisted is replayed as a clean result.',
};

type Props = { params: Promise<{ id: string }> };

/**
 * The title follows the run, because the browser ends up with THIS title. When
 * the page below calls `notFound()`, the HTML carries the not-found title, but
 * the client then applies the metadata of the render that threw, which is this
 * one. A fixed title here left a 404 tab reading "Live Attack Replay".
 * `resolveRun` is cached per request, so this is not a second lookup.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return (await resolveRun(id)) ? PAGE_METADATA : { title: RUN_NOT_FOUND_TITLE };
}

/**
 * Live Attack Replay (route `/runs/[id]`, register: PRODUCT, the hero). Server
 * component: resolves the run through `resolveRun` and hands the observable
 * `RunResult` to the client Replay, along with the provenance of its verdict.
 *
 * TWO KINDS OF RUN reach this screen through one door. The sample is the no-key
 * demonstration and needs no sign-in; anything else is one of the signed-in
 * user's own PERSISTED runs, read owner-scoped through the repository port. An id
 * that is neither is a 404, and the route's `not-found.tsx` draws the labelled
 * empty state under it. It used to fall back to the sample, which would show a
 * stranger a constructed demonstration under their own run id, and then to
 * render the empty state with a 200.
 *
 * ONE ANSWER FOR EVERY ID THE VIEWER MAY NOT SEE. `notFound()` carries no id and
 * no reason, so a run on another account answers exactly as an id that never
 * existed: same status, same body, same title.
 *
 * The route `id` travels into the Replay as well. It is the only id the report
 * route can resolve: a saved live run is stored under a row id, and the run id on
 * its verdict is the live session's, a different string.
 */
export default async function RunReplay({ params }: Props) {
  const { id } = await params;
  const view = await resolveRun(id);
  if (!view) notFound();
  return <Replay run={view.run} routeId={id} provenance={view.provenance} />;
}
