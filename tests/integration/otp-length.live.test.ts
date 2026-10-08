import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEmailOtpLength } from '@/config/env';

/**
 * Does the LIVE Supabase project actually emit the number of digits the UI
 * promises? Gated on Supabase creds, so it SKIPS in CI and normal unit runs and
 * only executes when the env is loaded from `.env.local`.
 *
 * WHY THIS EXISTS, specifically. The unit guards prove the copy, the placeholder
 * and the accepted length all derive from one constant — that the app is
 * self-consistent. They cannot prove the constant matches the dashboard, and
 * that is the pairing that actually broke: the project emitted 8 while the UI
 * said 6, and no test in the repo could tell. This is the only check that closes
 * code-versus-reality, and it caught a real drift on 2026-07-31 when an intended
 * dashboard change to 6 had not taken effect.
 *
 * `admin.generateLink` returns `properties.email_otp` in plaintext, so the
 * length is readable with no inbox and no brute force. NOTE the boundary of what
 * that justifies: generateLink is an ADMIN path and must NEVER be trusted for
 * FLOW TYPE — trusting it there is exactly what hid the PKCE bug. Length is a
 * property of the shared OTP generator, so it reads correctly from either path.
 *
 * Self-cleaning: provisions a throwaway user and deletes it, so the operator's
 * own outstanding sign-in token is never clobbered.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = Boolean(URL && SERVICE);

describe.runIf(LIVE)('email OTP length — live Supabase project', () => {
  // `describe.runIf` still executes this body to collect specs, so the client is
  // built lazily in beforeAll (which does not run when skipped) — otherwise
  // createClient throws "supabaseUrl is required" during credential-free runs.
  let admin: SupabaseClient;
  const email = `otp-length-probe-${Date.now()}@mcproof.test`;
  let userId = '';

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it('emits exactly the number of digits the UI promises', async () => {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    expect(error).toBeNull();

    const otp = data?.properties?.email_otp ?? '';
    expect(otp, 'no email_otp was returned').toMatch(/^\d+$/);
    expect(
      otp.length,
      `The live project emits a ${otp.length}-digit code but the app promises ` +
        `${getEmailOtpLength()}. Either set NEXT_PUBLIC_EMAIL_OTP_LENGTH to ${otp.length}, ` +
        `or change Email OTP Length in the Supabase dashboard. Until they agree, ` +
        `the sign-in copy is untrue and the form will refuse every real code.`,
    ).toBe(getEmailOtpLength());
  });
});
