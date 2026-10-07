import { requestedRouteId } from '@/lib/route-id';
import { ReplayEmpty } from './ReplayEmpty';

/** The tab title of the replay's not-found answer, on both ways of reaching it. */
export const RUN_NOT_FOUND_TITLE = 'Run not found · MCPwn';

/**
 * What `/runs/[id]` answers, with a 404, for an id that resolves to no run the
 * viewer may see. ONE component for both ways there, so they cannot drift apart:
 *
 *   - the middleware rewrite, for an id that cannot be a run at all, which is
 *     server-rendered in full;
 *   - the route's `not-found.tsx`, for an id shaped like a row id that the page
 *     looked up and did not find (or may not show).
 *
 * The words are the empty state this screen always had.
 */
export async function ReplayNotFound() {
  return <ReplayEmpty id={await requestedRouteId('runs')} />;
}
