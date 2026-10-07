import { FindingsEmpty } from '@/components/findings';
import { requestedRouteId } from '@/lib/route-id';

/**
 * What `/findings/[id]` answers, with a 404, for an id that resolves to no
 * report the viewer may see. The words are the empty state this screen always
 * had; the status is new.
 */
export default async function ReportNotFound() {
  return <FindingsEmpty id={await requestedRouteId('findings')} />;
}
