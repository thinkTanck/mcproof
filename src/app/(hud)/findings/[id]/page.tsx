import { notFound } from 'next/navigation';
import { resolveDiscardedRun, resolveFixReport } from '@/data/run-view';
import { RunDiscarded } from '@/components/replay';
import { RUN_DISCARDED_TITLE } from '@/runs/discard-copy';
import type { Metadata } from 'next';
import { FindingsReport, REPORT_NOT_FOUND_TITLE, reportTitle } from '@/components/findings';

/**
 * Findings / fix report screen (`/findings/[id]`). Reads through `resolveFixReport`,
 * so everything on the page — category, severity, run id, offending step, prose,
 * remediation — binds from module 6's real `generateFixReport` output over a real
 * `RunResult`. An id that resolves to nothing is a 404, and the route's
 * `not-found.tsx` draws the labelled empty state under it. A run on another
 * account answers exactly as an id that never existed.
 *
 * The run behind the report is either the no-key sample (open to everyone) or one
 * of the signed-in user's own persisted live runs (owner-scoped at the repository
 * port and at the database). The resolver also supplies the verdict's PROVENANCE,
 * so the page never has to decide on its own whether what it is showing is a
 * demonstration or a live capture.
 *
 * A run its owner DISCARDED
 * ([ADR-0013](docs/adr/0013-a-discarded-run-is-stored-unjudged.md)) has no
 * report and never gets one. Its owner sees the discarded state with a 200;
 * anybody else gets the same 404 as for an id that never existed.
 *
 * The route `id` is handed to the report too, so a clean result can link back to
 * the replay of the same run at `/runs/[id]`. Both routes resolve that one id.
 */
type Props = { params: Promise<{ id: string }> };

/**
 * A report that resolves is titled for what it is (a fix report, or a clean
 * run's result); one that does not gets the not-found title. Both are set on the
 * PAGE because the browser applies the metadata of the render that called
 * `notFound()`, not the not-found file's. `resolveFixReport` reads through a
 * resolver cached per request.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const view = await resolveFixReport(id);
  if (view) return { title: reportTitle(view.report) };
  // A run its owner discarded has a title of its own. For anyone else this is
  // null, so they get the not-found title, exactly as for an unknown id.
  return { title: (await resolveDiscardedRun(id)) ? RUN_DISCARDED_TITLE : REPORT_NOT_FOUND_TITLE };
}

export default async function FindingsScreen({ params }: Props) {
  const { id } = await params;
  const view = await resolveFixReport(id);
  if (!view) {
    // NO REPORT IS BUILT FOR A DISCARDED RUN. It has no verdict, so
    // `resolveFixReport` found no run to hand to `generateFixReport`, and what
    // the owner is shown is the plain discarded state, not an empty report.
    const discarded = await resolveDiscardedRun(id);
    if (!discarded) notFound();
    return (
      <RunDiscarded
        surface="report"
        category={discarded.discarded.category}
        discardedAt={discarded.discarded.discardedAt}
      />
    );
  }
  return <FindingsReport report={view.report} routeId={id} />;
}
