import { renderShareCard } from '@/lib/og/share-card';

/**
 * The site's link preview image (og:image), the card drawn by
 * `src/lib/og/share-card.tsx`. A plain route, not Next's `opengraph-image`
 * file convention: a convention file names its own URL and overrides the
 * `images` the root layout declares, and the layout's URL carries `?v=` and
 * `SHARE_CARD_VERSION` so a crawler that cached an older card fetches again.
 * The query is ignored here; every version is the one card. Built once, at
 * build time.
 */
export const dynamic = 'force-static';

export function GET() {
  return renderShareCard();
}
