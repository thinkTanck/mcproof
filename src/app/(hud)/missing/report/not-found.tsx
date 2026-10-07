import type { Metadata } from 'next';
import { ReportNotFound, REPORT_NOT_FOUND_TITLE } from '@/components/findings';

/**
 * HERE FOR THE TITLE. On a 404 response Next takes the page title from the
 * deepest `not-found.tsx` on the route's path and lets it override the page's
 * own. Without this file the rewritten page was titled by the root not-found.
 * It renders the same component as the page beside it.
 */
export const metadata: Metadata = { title: REPORT_NOT_FOUND_TITLE };

export default ReportNotFound;
