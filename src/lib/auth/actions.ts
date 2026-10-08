'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sanitizeNext } from './next';
import { createOtpSenderSupabase, createServerSupabase } from '@/lib/supabase/server';
import { readableAuthError } from '@/lib/auth/errors';
import { clientIpFromHeaders, otpRateLimiter } from '@/lib/auth/otp-rate-limit';

/** Result the sign-in UI renders. `error` is always human copy, never provider
 *  machine text (auth-js will hand us `"{}"` given an empty GoTrue body). */
export type AuthResult = { ok: true } | { ok: false; error: string };

/** GoTrue normalizes addresses; match it so the send and the verify agree. */
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Absolute site origin, from the (proxied) request headers — works on preview + prod. */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/**
 * Email OTP: email the address a one-time code (the Supabase email templates
 * must emit `{{ .Token }}`). Returns a typed result so the panel can advance to
 * the code step or show a failure without leaving the page. Inert (ok:false)
 * when auth is not configured — the panel keeps its preview state.
 *
 * Sent through `createOtpSenderSupabase()` (implicit flow) and NOT the
 * cookie-bound SSR client: `@supabase/ssr` forces `flowType: "pkce"`, under
 * which GoTrue stores a flow-state auth code instead of `sha224(email + otp)`
 * and no emailed code can ever verify. See that factory for the full trace.
 *
 * RATE LIMITED BEFORE ANYTHING IS SENT (`./otp-rate-limit.ts`). This is the
 * ABUSE BACKSTOP from [ADR-0007](../../../docs/adr/0007-access-and-cost-model.md),
 * not the cost control: the per-account lifetime allowance is what bounds spend,
 * and it only means anything if a fresh account is not free to mint. The check
 * runs after the configured/inert branch (an unconfigured app sends nothing, so
 * there is nothing to bound) and before the provider call, so a refused request
 * costs neither an email nor a round trip. Its refusal is the same sentence the
 * provider's own rate limit renders, so the two are indistinguishable.
 */
export async function requestEmailCode(email: string): Promise<AuthResult> {
  const supabase = createOtpSenderSupabase();
  if (!supabase) return { ok: false, error: 'Sign-in is not configured yet.' };

  const decision = await otpRateLimiter.check({
    email,
    ip: clientIpFromHeaders(await headers()),
  });
  if (!decision.allowed) return { ok: false, error: decision.error.message };

  const { error } = await supabase.auth.signInWithOtp({
    email: normalizeEmail(email),
    options: { shouldCreateUser: true },
  });
  if (error) {
    return {
      ok: false,
      error: readableAuthError(error, 'We could not send that code. Try again.'),
    };
  }
  return { ok: true };
}

/** GoTrue error classes that mean "this code did not match THIS token type" —
 *  the only ones worth retrying as a signup OTP. Anything else (a rate limit,
 *  a disabled provider) would just be masked by a second failing attempt. */
function isCodeMismatch(error: { code?: string; message?: string }): boolean {
  if (error.code) return error.code === 'otp_expired' || error.code === 'otp_disabled';
  return /token has expired or is invalid|otp_expired/i.test(error.message ?? '');
}

/**
 * Email OTP verify: exchange the typed code for a session. Tries the sign-in OTP
 * type, then the signup OTP type (a brand-new account's first code). On success
 * the cookie-bound server client has set the session cookies, so we redirect to
 * a sanitized `next`. verifyOtp IS the whole flow — no PKCE, no callback, so an
 * email scanner or a different browser can never break it.
 *
 * The code is passed through as GoTrue issued it, minus whitespace. Its LENGTH
 * is a project setting (Supabase allows 6 to 10; this project emits 8), so
 * nothing here may assume, pad, or truncate it.
 */
export async function verifyEmailCode(
  email: string,
  token: string,
  next?: string,
): Promise<AuthResult> {
  const supabase = await createServerSupabase();
  if (!supabase) return { ok: false, error: 'Sign-in is not configured yet.' };

  const address = normalizeEmail(email);
  const code = token.replace(/\s+/g, '');

  let { error } = await supabase.auth.verifyOtp({ email: address, token: code, type: 'email' });
  if (error && isCodeMismatch(error)) {
    ({ error } = await supabase.auth.verifyOtp({ email: address, token: code, type: 'signup' }));
  }
  if (error) {
    return {
      ok: false,
      error: readableAuthError(error, 'We could not verify that code. Request a new one.'),
    };
  }

  redirect(sanitizeNext(next));
}

/**
 * GitHub OAuth: kick off the provider flow and redirect the browser to GitHub.
 * A no-op when auth is inert. The button that calls this is itself gated behind
 * isGithubOAuthEnabled, so this only runs once GitHub is configured.
 */
export async function startGitHubOAuth(): Promise<void> {
  const supabase = await createServerSupabase();
  if (!supabase) return;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: `${await siteOrigin()}/auth/callback` },
  });
  if (error || !data?.url) return;
  redirect(data.url);
}

/** Sign out and return to the front door. */
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabase();
  if (supabase) await supabase.auth.signOut();
  redirect('/');
}
