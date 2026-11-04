import { SHARE_CARD_ALT, SHARE_CARD_SIZE, renderShareCard } from '@/lib/og/share-card';

/**
 * The site's link preview image (og:image), for every route that does not set
 * its own. The card itself is `src/lib/og/share-card.tsx`; `twitter-image.tsx`
 * returns the same one.
 */
export const alt = SHARE_CARD_ALT;
export const size = SHARE_CARD_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return renderShareCard();
}
