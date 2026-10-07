import type { Metadata } from 'next';
import { ReportNotFound, REPORT_NOT_FOUND_TITLE } from '@/components/findings';

export const metadata: Metadata = { title: REPORT_NOT_FOUND_TITLE };

/**
 * THE REWRITE TARGET for `/findings/<id>` when the id cannot be a run. A real
 * page, so it is server-rendered in full; the middleware sets the 404 status on
 * the way here and answers a direct visit to this address with a 404 too.
 */
export default ReportNotFound;
