import { RATE_LIMITED_MESSAGE, readableAuthError } from '@/lib/auth/errors';

/**
 * A failed sign-in must always read as words. The provider is not a copywriter:
 * `@supabase/auth-js` falls back to `JSON.stringify(err)` when GoTrue's error
 * body carries none of msg/message/error_description/error, which is how a raw
 * `{}` reached the /sign-in screen. Nothing unreadable may ever reach the user.
 */
describe('readableAuthError', () => {
  const FALLBACK = 'We could not send that code. Try again in a moment.';

  it.each([
    ['{}', 'the JSON.stringify fallback from auth-js'],
    ['[]', 'an array body'],
    ['[object Object]', 'a stringified object'],
    ['', 'an empty message'],
    ['   ', 'a blank message'],
    ['unexpected_failure', 'a bare snake_case code with no mapping'],
  ])('replaces the unreadable %s (%s) with the fallback', (message) => {
    expect(readableAuthError({ message }, FALLBACK)).toBe(FALLBACK);
  });

  it('uses the fallback for a null or undefined error', () => {
    expect(readableAuthError(null, FALLBACK)).toBe(FALLBACK);
    expect(readableAuthError(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('maps an expired or wrong code to the actionable sentence', () => {
    const expected =
      'That code is incorrect or has expired. Enter the newest one, or resend a new code.';
    expect(readableAuthError({ code: 'otp_expired' }, FALLBACK)).toBe(expected);
    expect(readableAuthError({ message: 'Token has expired or is invalid' }, FALLBACK)).toBe(
      expected,
    );
    // GoTrue sometimes puts the bare code in the message field. Still not raw.
    expect(readableAuthError({ message: 'otp_expired' }, FALLBACK)).toBe(expected);
  });

  it.each([
    [{ code: 'over_email_send_rate_limit' }],
    [{ code: 'over_request_rate_limit' }],
    [{ status: 429 }],
    [{ message: 'For security purposes, you can only request this after 51 seconds.' }],
  ])('maps rate limiting to a wait-and-retry sentence (%o)', (err) => {
    expect(readableAuthError(err, FALLBACK)).toMatch(/too many|wait/i);
  });

  it('states the rate refusal as one generic sentence with no window it cannot keep', () => {
    // Our own limiters use 15-minute and 1-hour windows, so "about a minute" was
    // false. The sentence names no number, address or bucket (S1e).
    expect(RATE_LIMITED_MESSAGE).toBe('Too many attempts. Wait a few minutes, then try again.');
    expect(RATE_LIMITED_MESSAGE).not.toMatch(/\d/);
  });

  it('maps a rejected email address to a check-the-address sentence', () => {
    expect(readableAuthError({ code: 'validation_failed' }, FALLBACK)).toMatch(/email address/i);
  });

  it('passes a genuinely readable provider sentence through unchanged', () => {
    const msg = 'Signups are disabled for this project.';
    expect(readableAuthError({ message: msg }, FALLBACK)).toBe(msg);
  });

  it('never returns an empty string', () => {
    expect(readableAuthError({ message: '{}' }, '').length).toBeGreaterThan(0);
  });
});
