import { SHARE_CARD_ALT, SHARE_CARD_SIZE, renderShareCard } from '@/lib/og/share-card';

/**
 * The site's Twitter card image: the same card as `opengraph-image.tsx`, from
 * `src/lib/og/share-card.tsx`.
 */
export const alt = SHARE_CARD_ALT;
export const size = SHARE_CARD_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return renderShareCard();
}
