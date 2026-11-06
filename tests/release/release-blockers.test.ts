import { BOOKING_PLACEHOLDER, BOOKING_URL, isBookingLive } from '@/config/booking';
import { LEGAL_STATUS } from '@/lib/legal/meta';
import { SECURITY_CONTACT, buildSecurityTxt } from '@/config/security-txt';

/**
 * RELEASE BLOCKERS (RELEASE PLAN, ruled 2026-11-05; marketing plan section 8).
 *
 * These are expected to FAIL on the release branch until each blocker is
 * cleared, which is why they live outside the default suite (vitest.config.ts
 * includes only tests/unit and tests/integration). They run through
 * `npm run test:release`, which CI calls in the required CI Gate job only on a
 * pull request from release/monetization into main. So branch CI stays green,
 * and the release cannot merge while any of these is still open.
 */

describe('release blockers', () => {
  it('BOOKING_URL is a real Calendly link (Q1)', () => {
    expect(BOOKING_URL).not.toBe(BOOKING_PLACEHOLDER);
    expect(isBookingLive(BOOKING_URL)).toBe(true);
  });

  it('the Terms and Privacy pages are approved, not draft (Q3)', () => {
    expect(LEGAL_STATUS).toBe('approved');
  });

  it('security.txt names no personal gmail address (Q2)', () => {
    expect(SECURITY_CONTACT).not.toMatch(/gmail\.com/i);
    expect(buildSecurityTxt('https://mcproof.dev')).not.toMatch(/gmail\.com/i);
  });
});
