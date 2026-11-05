import { renderShareCard } from '@/lib/og/share-card';

/**
 * The site's Twitter card image: the same card as `/opengraph-image`, from
 * `src/lib/og/share-card.tsx`, and a plain route for the same reason (see
 * `src/app/opengraph-image/route.ts`).
 */
export const dynamic = 'force-static';

export function GET() {
  return renderShareCard();
}
