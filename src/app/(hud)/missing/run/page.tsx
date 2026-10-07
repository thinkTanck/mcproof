import type { Metadata } from 'next';
import { ReplayNotFound, RUN_NOT_FOUND_TITLE } from '@/components/replay';

export const metadata: Metadata = { title: RUN_NOT_FOUND_TITLE };

/**
 * THE REWRITE TARGET for `/runs/<id>` when the id cannot be a run. It is a real
 * page so that it is server-rendered in full, which a page that calls
 * `notFound()` is not; the middleware sets the 404 status on the way here and
 * answers a direct visit to this address with a 404 too. It reads the id from
 * the path the visitor asked for, so it is dynamic.
 */
export default ReplayNotFound;
