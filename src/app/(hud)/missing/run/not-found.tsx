import type { Metadata } from 'next';
import { ReplayNotFound, RUN_NOT_FOUND_TITLE } from '@/components/replay';

/**
 * HERE FOR THE TITLE. On a 404 response Next takes the page title from the
 * deepest `not-found.tsx` on the route's path and lets it override the page's
 * own (`next/dist/lib/metadata/resolve-metadata.js`, `collectMetadata`). Without
 * this file the rewritten page was titled by the root not-found. It renders the
 * same component as the page beside it, though nothing here calls `notFound()`.
 */
export const metadata: Metadata = { title: RUN_NOT_FOUND_TITLE };

export default ReplayNotFound;
