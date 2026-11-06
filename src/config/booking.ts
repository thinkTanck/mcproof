/**
 * THE BOOKING LINK (MARKETING PASS, ruled 2026-11-03: one URL constant, opens in
 * a new tab).
 *
 * A src constant and not an env variable: a `NEXT_PUBLIC_` value is inlined at
 * build time, can differ between preview and production, and is invisible to
 * CI, so the release blocker could not be enforced. Here the same commit is the
 * same link everywhere, and tests/release/release-blockers.test.ts refuses a
 * release while it is still the placeholder.
 *
 * Read the URL only through `BookingLink` (src/components/hud/BookingLink.tsx).
 * A page that needs to know whether booking is open imports `isBookingLive`.
 * Guarded by tests/unit/config/booking.guard.test.ts.
 */

/** The placeholder. While BOOKING_URL equals it, every booking control is hidden. */
export const BOOKING_PLACEHOLDER = 'https://calendly.com/PLACEHOLDER';

/** THE booking link. A real link is a RELEASE BLOCKER (Q1). */
export const BOOKING_URL: string = BOOKING_PLACEHOLDER;

/**
 * Is this a real, bookable link? An https link on calendly.com itself (no
 * subdomain, no look-alike host), with at least one path segment, no segment
 * that reads "placeholder", and no credentials.
 */
export function isBookingLive(url: string = BOOKING_URL): boolean {
  if (url === BOOKING_PLACEHOLDER) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname !== 'calendly.com') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  const segments = parsed.pathname.split('/').filter((s) => s !== '');
  if (segments.length === 0) return false;
  return !segments.some((s) => s.toLowerCase() === 'placeholder');
}

/** The link to render, or null when there is none to offer. */
export function bookingUrl(url: string = BOOKING_URL): string | null {
  return isBookingLive(url) ? url : null;
}

/** The attributes every booking anchor carries. */
export const BOOKING_LINK_ATTRS = { target: '_blank', rel: 'noopener noreferrer' } as const;
