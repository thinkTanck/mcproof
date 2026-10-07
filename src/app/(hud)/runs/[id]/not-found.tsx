import type { Metadata } from 'next';
import { ReplayNotFound, RUN_NOT_FOUND_TITLE } from '@/components/replay';

export const metadata: Metadata = { title: RUN_NOT_FOUND_TITLE };

/**
 * Drawn when the page calls `notFound()`: an id shaped like a row id that
 * resolved to nothing. Next 16.3.7 sends this to the browser to render, not as
 * HTML (issue #189). An id that cannot be a run never gets this far: the
 * middleware answers it with the same component, server-rendered.
 */
export default ReplayNotFound;
