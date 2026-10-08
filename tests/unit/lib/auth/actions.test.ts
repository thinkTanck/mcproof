import { requestEmailCode, verifyEmailCode } from '@/lib/auth/actions';
import { createServerSupabase, createOtpSenderSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { OTP_RATE_LIMIT, otpRateLimitStore } from '@/lib/auth/otp-rate-limit';
import { BAD_EMAIL_MESSAGE, RATE_LIMITED_MESSAGE } from '@/lib/auth/errors';

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (k: string) =>
      k === 'host' ? 'mcproof.test' : k === 'x-forwarded-proto' ? 'https' : null,
  }),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(),
  createOtpSenderSupabase: vi.fn(),
}));

const mockOtp = (otp: ReturnType<typeof vi.fn>) =>
  vi.mocked(createOtpSenderSupabase).mockReturnValue({ auth: { signInWithOtp: otp } } as never);
const mockVerify = (verifyOtp: ReturnType<typeof vi.fn>) =>
  vi.mocked(createServerSupabase).mockResolvedValue({ auth: { verifyOtp } } as never);

describe('requestEmailCode (email OTP request)', () => {
  // The limiter is process-wide state by design (a per-request one would count
  // every request as the first), so each test starts from an empty count.
  beforeEach(() => {
    vi.clearAllMocks();
    otpRateLimitStore.reset();
  });

  it('is inert (ok:false) when auth is not configured', async () => {
    vi.mocked(createOtpSenderSupabase).mockReturnValue(null);
    expect((await requestEmailCode('a@b.com')).ok).toBe(false);
  });

  it('sends a code via signInWithOtp (no emailRedirectTo)', async () => {
    const otp = vi.fn().mockResolvedValue({ error: null });
    mockOtp(otp);
    expect(await requestEmailCode('a@b.com')).toEqual({ ok: true });
    expect(otp).toHaveBeenCalledWith({ email: 'a@b.com', options: { shouldCreateUser: true } });
  });

  /**
   * The Slice 1.5 prod bug: sending through the cookie-bound SSR client put
   * GoTrue on the PKCE branch, which stores a flow-state code instead of the
   * OTP hash, so no emailed code could ever verify. The send MUST go through
   * the implicit-flow sender.
   */
  it('sends through the implicit-flow sender, never the cookie-bound PKCE client', async () => {
    const otp = vi.fn().mockResolvedValue({ error: null });
    mockOtp(otp);
    const cookieBound = vi.fn();
    vi.mocked(createServerSupabase).mockResolvedValue({
      auth: { signInWithOtp: cookieBound },
    } as never);

    await requestEmailCode('a@b.com');

    expect(createOtpSenderSupabase).toHaveBeenCalled();
    expect(otp).toHaveBeenCalled();
    expect(cookieBound).not.toHaveBeenCalled();
  });

  it('trims and lower-cases the address so send and verify agree', async () => {
    const otp = vi.fn().mockResolvedValue({ error: null });
    mockOtp(otp);
    await requestEmailCode('  Real@User.COM  ');
    expect(otp).toHaveBeenCalledWith({
      email: 'real@user.com',
      options: { shouldCreateUser: true },
    });
  });

  it('renders a rate-limit error as words', async () => {
    mockOtp(vi.fn().mockResolvedValue({ error: { code: 'over_email_send_rate_limit' } }));
    const res = await requestEmailCode('a@b.com');
    expect(res).toMatchObject({ ok: false });
    expect(res.ok === false && res.error).toMatch(/too many|wait/i);
  });

  /**
   * The abuse backstop from ADR-0007. It bounds nothing about spend (the
   * lifetime allowance does that); it makes minting accounts cost time, which is
   * what a lifetime allowance needs to mean anything.
   */
  it('stops sending once an address has had its share, without calling the provider', async () => {
    const otp = vi.fn().mockResolvedValue({ error: null });
    mockOtp(otp);
    for (let i = 0; i < OTP_RATE_LIMIT.email.limit; i += 1) await requestEmailCode('a@b.com');
    const sentSoFar = otp.mock.calls.length;

    const res = await requestEmailCode('a@b.com');

    expect(res.ok).toBe(false);
    expect(otp).toHaveBeenCalledTimes(sentSoFar);
  });

  /**
   * A local refusal and a provider refusal must read the same, or the difference
   * is itself a signal about which control tripped and about the address that
   * tripped it.
   */
  it('states a local rate limit in the same words as the provider rate limit', async () => {
    mockOtp(vi.fn().mockResolvedValue({ error: null }));
    for (let i = 0; i < OTP_RATE_LIMIT.email.limit; i += 1) await requestEmailCode('a@b.com');

    const res = await requestEmailCode('a@b.com');

    expect(res.ok === false && res.error).toBe(RATE_LIMITED_MESSAGE);
  });

  it('never names the address, the bucket or the count when it refuses', async () => {
    mockOtp(vi.fn().mockResolvedValue({ error: null }));
    for (let i = 0; i < OTP_RATE_LIMIT.email.limit; i += 1) await requestEmailCode('a@b.com');

    const res = await requestEmailCode('a@b.com');
    const wire = res.ok === false ? res.error : '';

    expect(wire).not.toContain('a@b.com');
    expect(wire).not.toContain('email');
    expect(wire).not.toMatch(/\d+\s*(minutes?|requests?)/i);
  });

  it('refuses an unusable address before the provider is asked', async () => {
    const otp = vi.fn().mockResolvedValue({ error: null });
    mockOtp(otp);

    const res = await requestEmailCode(`${'x'.repeat(400)}@b.com`);

    expect(res).toEqual({ ok: false, error: BAD_EMAIL_MESSAGE });
    expect(otp).not.toHaveBeenCalled();
  });

  /** The raw `{}` that reached /sign-in: auth-js JSON.stringifies an empty body. */
  it('never surfaces a raw JSON error body', async () => {
    mockOtp(vi.fn().mockResolvedValue({ error: { message: '{}' } }));
    const res = await requestEmailCode('a@b.com');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).not.toBe('{}');
    expect(res.ok === false && res.error).toMatch(/[a-z]{3,}\s+[a-z]{2,}/i);
  });
});

describe('verifyEmailCode (email OTP verify)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is inert (ok:false) when auth is not configured', async () => {
    vi.mocked(createServerSupabase).mockResolvedValue(null);
    expect((await verifyEmailCode('a@b.com', '12345678')).ok).toBe(false);
  });

  it('verifies with type email and redirects to a safe next (cookies set first)', async () => {
    const order: string[] = [];
    const verifyOtp = vi.fn(async () => {
      order.push('verify');
      return { error: null };
    });
    vi.mocked(redirect).mockImplementation(() => {
      order.push('redirect');
      return undefined as never;
    });
    mockVerify(verifyOtp);
    await verifyEmailCode('a@b.com', '12345678', '/leaderboard');
    expect(verifyOtp).toHaveBeenCalledWith({ email: 'a@b.com', token: '12345678', type: 'email' });
    expect(redirect).toHaveBeenCalledWith('/leaderboard');
    expect(order).toEqual(['verify', 'redirect']);
  });

  /**
   * The project's Email OTP length is 8, not the 6 the first cut assumed.
   * Supabase allows 6 to 10, so the action must not care how long the code is
   * and must not reshape it; GoTrue is the authority.
   */
  it.each([['123456'], ['1234567'], ['12345678'], ['1234567890']])(
    'passes a %s-length code through unchanged',
    async (token) => {
      const verifyOtp = vi.fn().mockResolvedValue({ error: null });
      mockVerify(verifyOtp);
      await verifyEmailCode('a@b.com', token);
      expect(verifyOtp).toHaveBeenCalledWith({ email: 'a@b.com', token, type: 'email' });
    },
  );

  it('strips whitespace a user pasted around the code', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    mockVerify(verifyOtp);
    await verifyEmailCode('a@b.com', ' 123 456 ');
    expect(verifyOtp).toHaveBeenCalledWith({ email: 'a@b.com', token: '123456', type: 'email' });
  });

  it('falls back to type signup for a new-account code', async () => {
    const verifyOtp = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: 'otp_expired' } })
      .mockResolvedValueOnce({ error: null });
    mockVerify(verifyOtp);
    await verifyEmailCode('new@b.com', '87654321');
    expect(verifyOtp).toHaveBeenNthCalledWith(2, {
      email: 'new@b.com',
      token: '87654321',
      type: 'signup',
    });
    expect(redirect).toHaveBeenCalledWith('/account');
  });

  /** A rate limit is not a type mismatch. Retrying masks it and burns a request. */
  it('does not retry as signup when the failure is not a code mismatch', async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: { code: 'over_request_rate_limit' } });
    mockVerify(verifyOtp);
    const res = await verifyEmailCode('a@b.com', '12345678');
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(res.ok === false && res.error).toMatch(/too many|wait/i);
  });

  it('returns readable copy and does not redirect when both types fail', async () => {
    const verifyOtp = vi
      .fn()
      .mockResolvedValue({ error: { message: 'Token has expired or is invalid' } });
    mockVerify(verifyOtp);
    const res = await verifyEmailCode('a@b.com', '00000000');
    expect(res).toEqual({
      ok: false,
      error: 'That code is incorrect or has expired. Enter the newest one, or resend a new code.',
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ['//evil.com', '/account'],
    ['https://evil.com', '/account'],
    ['javascript:alert(1)', '/account'],
    ['/leaderboard', '/leaderboard'],
    [undefined, '/account'],
  ])('sanitizes next=%s to %s', async (next, expected) => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });
    mockVerify(verifyOtp);
    await verifyEmailCode('a@b.com', '12345678', next as string | undefined);
    expect(redirect).toHaveBeenCalledWith(expected);
  });
});
