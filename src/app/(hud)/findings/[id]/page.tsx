import { notFound } from 'next/navigation';
import { resolveFixReport } from '@/data/run-view';
import type { Metadata } from 'next';
import { FindingsReport, REPORT_NOT_FOUND_TITLE } from '@/components/findings';

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
 * The route `id` is handed to the report too, so a clean result can link back to
 * the replay of the same run at `/runs/[id]`. Both routes resolve that one id.
 */
type Props = { params: Promise<{ id: string }> };

/**
 * Only the not-found title is set here; a report that resolves keeps the site
 * title it always had. It is set on the PAGE because the browser applies the
 * metadata of the render that called `notFound()`, not the not-found file's.
 * `resolveFixReport` reads through a resolver cached per request.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return (await resolveFixReport(id)) ? {} : { title: REPORT_NOT_FOUND_TITLE };
}

export default async function FindingsScreen({ params }: Props) {
  const { id } = await params;
  const view = await resolveFixReport(id);
  if (!view) notFound();
  return <FindingsReport report={view.report} routeId={id} />;
}
