/**
 * Provider errors → words a person can act on.
 *
 * A sign-in failure is the one moment the user is stuck, so it is the last place
 * to leak machine text. `@supabase/auth-js` ends `_getErrorMessage` with
 * `JSON.stringify(err)` when GoTrue's error body carries none of
 * msg/message/error_description/error, so an empty body surfaced a literal `{}`
 * on /sign-in. GoTrue also emits bare snake_case codes (`otp_expired`) that are
 * accurate and unreadable.
 *
 * Rule: map the failures we know, pass through provider text only when it is
 * already a sentence, and fall back to the caller's context line otherwise.
 * The result is never empty.
 */

/** The shape both `AuthError` and `AuthApiError` satisfy (all fields optional). */
export interface AuthErrorLike {
  message?: string;
  code?: string;
  status?: number;
}

const WRONG_OR_EXPIRED_CODE =
  'That code is incorrect or has expired. Enter the newest one, or resend a new code.';

/**
 * The ONE sentence a rate-limited sign-in ever sees, wherever the limit came
 * from. Exported because our own limiter (`./otp-rate-limit.ts`) states it too:
 * if a local refusal and a provider refusal read differently, the difference is
 * itself a signal about which control tripped, and about the address that
 * tripped it. One sentence, no numbers, no address, no bucket.
 */
export const RATE_LIMITED_MESSAGE = 'Too many attempts. Wait a few minutes, then try again.';

const RATE_LIMITED = RATE_LIMITED_MESSAGE;
/**
 * Exported for the same reason as {@link RATE_LIMITED_MESSAGE}: our own sign-in
 * path refuses an unusable address before the provider ever sees it, and the two
 * refusals must read identically or the difference is a signal in itself.
 */
export const BAD_EMAIL_MESSAGE = 'That email address was rejected. Check it and try again.';

const BAD_EMAIL = BAD_EMAIL_MESSAGE;
const UNAVAILABLE = 'Email sign-in is unavailable right now. Try again later.';
const LAST_RESORT = 'Something went wrong. Try again in a moment.';

/** GoTrue `error_code` → our copy. Exact codes only; message matching is below. */
const BY_CODE: Record<string, string> = {
  otp_expired: WRONG_OR_EXPIRED_CODE,
  otp_disabled: UNAVAILABLE,
  over_email_send_rate_limit: RATE_LIMITED,
  over_request_rate_limit: RATE_LIMITED,
  over_sms_send_rate_limit: RATE_LIMITED,
  validation_failed: BAD_EMAIL,
  email_address_invalid: BAD_EMAIL,
  email_address_not_authorized: BAD_EMAIL,
  email_provider_disabled: UNAVAILABLE,
  signup_disabled: UNAVAILABLE,
};

/** Message-text fallbacks for GoTrue responses that carry no `error_code`. */
const BY_MESSAGE: [RegExp, string][] = [
  [/token has expired or is invalid/i, WRONG_OR_EXPIRED_CODE],
  [/expired|invalid.*(token|otp|code)/i, WRONG_OR_EXPIRED_CODE],
  [/rate limit|only request this after|too many/i, RATE_LIMITED],
  [/invalid.*email|email.*invalid|unable to validate email/i, BAD_EMAIL],
];

/**
 * True when a provider string is a sentence rather than machine text: it has
 * whitespace-separated words and does not look like a serialized object or a
 * bare snake_case identifier. `{}`, `[object Object]` and `otp_expired` all fail.
 */
function isReadableSentence(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (/^[[{]/.test(trimmed)) return false;
  if (trimmed === '[object Object]') return false;
  if (!/\s/.test(trimmed)) return false; // a single token is a code, not a sentence
  if (!/[A-Za-z]{2}/.test(trimmed)) return false;
  return true;
}

/**
 * Render a provider auth error as user-facing copy.
 *
 * @param err      the provider error (or null/undefined when there is none)
 * @param fallback context-specific copy used when nothing else is readable
 */
export function readableAuthError(err: AuthErrorLike | null | undefined, fallback: string): string {
  const safeFallback = fallback.trim() || LAST_RESORT;
  if (!err) return safeFallback;

  const byCode = err.code ? BY_CODE[err.code] : undefined;
  if (byCode) return byCode;
  if (err.status === 429) return RATE_LIMITED;

  const message = err.message ?? '';
  for (const [pattern, copy] of BY_MESSAGE) {
    if (pattern.test(message)) return copy;
  }

  return isReadableSentence(message) ? message.trim() : safeFallback;
}
