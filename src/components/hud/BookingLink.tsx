import type { ReactNode } from 'react';
import { BOOKING_LINK_ATTRS, BOOKING_URL, bookingUrl } from '@/config/booking';

/**
 * THE ONE BOOKING ANCHOR (P0).
 *
 * Every "book a call" control on the site is this component. While the booking
 * link is the placeholder it returns null: no anchor, no empty wrapper, nothing
 * in the tab order, never hidden by CSS or `aria-hidden`. A block whose only
 * content is the booking control checks `isBookingLive()` itself and draws
 * nothing either, so no orphan heading or sentence is left behind.
 *
 * With a real link it is one outlined control, the same look as ConnectCta,
 * that opens Calendly in a new tab (`noopener noreferrer`) and says so to a
 * screen reader. It is a plain link, never the Calendly widget, so the content
 * security policy needs nothing new.
 *
 * `url` exists for tests and defaults to the one constant.
 */
export function BookingLink({
  children,
  url = BOOKING_URL,
}: {
  children: ReactNode;
  url?: string;
}) {
  const href = bookingUrl(url);
  if (href === null) return null;
  return (
    <a
      href={href}
      {...BOOKING_LINK_ATTRS}
      data-cta="book-assessment"
      className="glow-accent target-min inline-flex items-center justify-center gap-2 rounded-md border border-nominal bg-transparent px-5 py-2.5 font-mono text-[14px] tracking-[0.06em] text-ink transition-colors hover:bg-nominal/10 hover:text-readout"
    >
      {children} <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
