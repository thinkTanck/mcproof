import { requestedRouteId } from '@/lib/route-id';
import { FindingsEmpty } from './FindingsEmpty';

/** The tab title of the report's not-found answer, on both ways of reaching it. */
export const REPORT_NOT_FOUND_TITLE = 'Report not found · MCProof';

/**
 * What `/findings/[id]` answers, with a 404, for an id that resolves to no
 * report the viewer may see. ONE component for both ways there (the middleware
 * rewrite and the route's `not-found.tsx`), so they cannot drift apart. The
 * words are the empty state this screen always had.
 */
export async function ReportNotFound() {
  return <FindingsEmpty id={await requestedRouteId('findings')} />;
}
