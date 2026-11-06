import {
  BOOKING_LINK_ATTRS,
  BOOKING_PLACEHOLDER,
  BOOKING_URL,
  bookingUrl,
  isBookingLive,
} from '@/config/booking';

/**
 * THE ONE BOOKING LINK (MARKETING PASS, ruled 2026-11-03; P0).
 *
 * Every "book a call" control reads one constant. While it is the placeholder,
 * no booking control is drawn anywhere, and a real link is a release blocker
 * (tests/release/booking-live.test.ts). A link counts as real only when it is an
 * https link on calendly.com itself, with a path and no credentials.
 */

describe('the booking link', () => {
  it('ships as the placeholder until Dame supplies the real link', () => {
    expect(BOOKING_PLACEHOLDER).toBe('https://calendly.com/PLACEHOLDER');
    expect(BOOKING_URL).toBe(BOOKING_PLACEHOLDER);
  });

  it('the placeholder is not live', () => {
    expect(isBookingLive(BOOKING_PLACEHOLDER)).toBe(false);
    expect(bookingUrl(BOOKING_PLACEHOLDER)).toBeNull();
    expect(isBookingLive()).toBe(false);
    expect(bookingUrl()).toBeNull();
  });

  it.each([
    'http://calendly.com/x',
    'https://calendly.com.evil.example/x',
    'https://evil.example/calendly.com/x',
    'https://www.calendly.com/x',
    'https://calendly.com/',
    'https://calendly.com',
    'https://calendly.com/PLACEHOLDER',
    'https://calendly.com/placeholder/x',
    'https://calendly.com/x/Placeholder',
    'https://u:p@calendly.com/x',
    'https://u@calendly.com/x',
    'javascript:alert(1)',
    'not a url',
    '',
  ])('refuses %j', (url) => {
    expect(isBookingLive(url)).toBe(false);
    expect(bookingUrl(url)).toBeNull();
  });

  it('accepts a real Calendly https link and hands it back unchanged', () => {
    const real = 'https://calendly.com/agentrifi/assessment-scoping-call';
    expect(isBookingLive(real)).toBe(true);
    expect(bookingUrl(real)).toBe(real);
  });

  it('every booking anchor opens in a new tab with noopener noreferrer', () => {
    expect(BOOKING_LINK_ATTRS).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
  });
});
