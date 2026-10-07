import { ReplayEmpty } from '@/components/replay';
import { requestedRouteId } from '@/lib/route-id';

/**
 * What `/runs/[id]` answers, with a 404, for an id that resolves to no run the
 * viewer may see: an unknown id, an unfinished run, or a run on another account.
 * The words are the empty state this screen always had; the status is new.
 */
export default async function RunNotFound() {
  return <ReplayEmpty id={await requestedRouteId('runs')} />;
}
