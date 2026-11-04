/**
 * What the root layout needs to NAME the share card, kept apart from the code
 * that draws it (`share-card.tsx`), so the layout does not import `next/og`.
 */

/** The card's size, the one Open Graph and Twitter both draw at 1.91:1. */
export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

/**
 * The card's version, in the image URL as `?v=` (`src/app/layout.tsx`).
 * LinkedIn and others cache a card by its image URL, so change this whenever
 * the card's picture changes, or a link already shared keeps the old one.
 */
export const SHARE_CARD_VERSION = '2';

/** og:image:alt and twitter:image:alt: what the card shows, in words. */
export const SHARE_CARD_ALT =
  'MCProof. A replay of an AI agent reading a file outside its task, marked compromised at step 6.';

/** The Open Graph image entry: the card, with the version in its URL. */
export const OG_IMAGE = {
  url: `/opengraph-image?v=${SHARE_CARD_VERSION}`,
  ...SHARE_CARD_SIZE,
  type: 'image/png',
  alt: SHARE_CARD_ALT,
} as const;

/** The Twitter image entry: the same card, at its own path. */
export const TWITTER_IMAGE = {
  url: `/twitter-image?v=${SHARE_CARD_VERSION}`,
  alt: SHARE_CARD_ALT,
} as const;
