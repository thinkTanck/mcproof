/**
 * S1e: an app-level limit on ENTERING a code (verifyEmailCode).
 *
 * Sign-in runs on the server, so every verifyOtp call reaches Supabase from the
 * deployment's own addresses, shared by every user. Supabase's per-IP limit on
 * verification therefore counts all of them together, and one person guessing
 * codes could use it up and block code entry for everyone. The app's own limit
 * runs first, per address and per source, before Supabase is asked anything.
 */
import { requestEmailCode, verifyEmailCode } from '@/lib/auth/actions';
import { createOtpSenderSupabase, createServerSupabase } from '@/lib/supabase/server';
import {
  InMemoryOtpRateLimitStore,
  OTP_RATE_LIMIT,
  OTP_VERIFY_RATE_LIMIT,
  createOtpRateLimiter,
  otpRateLimitStore,
} from '@/lib/auth/otp-rate-limit';
import { RATE_LIMITED_MESSAGE } from '@/lib/auth/errors';

let clientIp: string | null = '203.0.113.7';

vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (k: string) =>
      k === 'host'
        ? 'mcproof.test'
        : k === 'x-forwarded-proto'
          ? 'https'
          : k === 'x-forwarded-for'
            ? clientIp
            : null,
  }),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: vi.fn(),
  createOtpSenderSupabase: vi.fn(),
}));

/** A provider refusal that is not a code mismatch, so each attempt is exactly one provider call. */
const refused = () => vi.fn().mockResolvedValue({ error: { code: 'validation_failed' } });

function mockVerify(verifyOtp: ReturnType<typeof vi.fn>) {
  vi.mocked(createServerSupabase).mockResolvedValue({ auth: { verifyOtp } } as never);
  return verifyOtp;
}

beforeEach(() => {
  vi.clearAllMocks();
  otpRateLimitStore.reset();
  clientIp = '203.0.113.7';
});

describe('the verify limit, as numbers', () => {
  it('is 5 attempts per address and 20 per source, each per 15 minutes', () => {
    expect(OTP_VERIFY_RATE_LIMIT.email).toEqual({ limit: 5, windowMs: 15 * 60_000 });
    expect(OTP_VERIFY_RATE_LIMIT.ip).toEqual({ limit: 20, windowMs: 15 * 60_000 });
  });
});

describe('verifyEmailCode stops before Supabase once a count is used up', () => {
  it('refuses the 6th attempt for one address and does not call Supabase for it', async () => {
    const verifyOtp = mockVerify(refused());
    for (let i = 0; i < 5; i++) {
      expect((await verifyEmailCode('user@example.com', '00000000')).ok).toBe(false);
    }
    expect(verifyOtp).toHaveBeenCalledTimes(5);
    vi.mocked(createServerSupabase).mockClear();

    const sixth = await verifyEmailCode('user@example.com', '00000000');

    expect(sixth).toEqual({ ok: false, error: RATE_LIMITED_MESSAGE });
    expect(verifyOtp).toHaveBeenCalledTimes(5);
    expect(createServerSupabase).not.toHaveBeenCalled();
  });

  it('refuses the 21st attempt from one source, across different addresses', async () => {
    const verifyOtp = mockVerify(refused());
    for (let i = 0; i < 20; i++) {
      await verifyEmailCode(`user${i}@example.com`, '00000000');
    }
    expect(verifyOtp).toHaveBeenCalledTimes(20);

    const next = await verifyEmailCode('someone-new@example.com', '00000000');

    expect(next).toEqual({ ok: false, error: RATE_LIMITED_MESSAGE });
    expect(verifyOtp).toHaveBeenCalledTimes(20);
  });

  it('counts an address the same however it is spaced or capitalised', async () => {
    const verifyOtp = mockVerify(refused());
    const spellings = [
      'User@Example.com',
      ' user@example.com',
      'USER@EXAMPLE.COM ',
      'user@example.com',
    ];
    for (const spelling of [...spellings, 'uSeR@eXaMpLe.CoM']) {
      await verifyEmailCode(spelling, '00000000');
    }
    expect(verifyOtp).toHaveBeenCalledTimes(5);

    expect(await verifyEmailCode('  USER@example.COM  ', '00000000')).toEqual({
      ok: false,
      error: RATE_LIMITED_MESSAGE,
    });
    expect(verifyOtp).toHaveBeenCalledTimes(5);
  });

  it('refuses in one generic sentence that names no address, source or count', async () => {
    mockVerify(refused());
    for (let i = 0; i < 5; i++) await verifyEmailCode('user@example.com', '00000000');

    const answer = await verifyEmailCode('user@example.com', '00000000');

    expect(answer).toEqual({ ok: false, error: RATE_LIMITED_MESSAGE });
    const text = answer.ok === false ? answer.error : '';
    expect(text).not.toMatch(/user@example\.com|203\.0\.113\.7|\b5\b|\b20\b|email|address|ip/i);
  });
});

describe('the verify and request counters are independent', () => {
  it('failed code entries never stop the user asking for a new code', async () => {
    mockVerify(refused());
    for (let i = 0; i < 6; i++) await verifyEmailCode('user@example.com', '00000000');

    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createOtpSenderSupabase).mockReturnValue({ auth: { signInWithOtp } } as never);

    expect(await requestEmailCode('user@example.com')).toEqual({ ok: true });
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it('a full request count never stops the user entering a code', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createOtpSenderSupabase).mockReturnValue({ auth: { signInWithOtp } } as never);
    for (let i = 0; i < OTP_RATE_LIMIT.email.limit; i++) await requestEmailCode('user@example.com');
    expect((await requestEmailCode('user@example.com')).ok).toBe(false);

    const verifyOtp = mockVerify(refused());
    await verifyEmailCode('user@example.com', '00000000');

    expect(verifyOtp).toHaveBeenCalledTimes(1);
  });
});

describe('the verify window drains', () => {
  function clock(startIso = '2026-10-14T00:00:00.000Z') {
    let at = new Date(startIso).getTime();
    return {
      now: () => new Date(at),
      advance: (ms: number) => {
        at += ms;
      },
    };
  }

  it('allows an address again once more than 15 minutes have passed', async () => {
    const time = clock();
    const limiter = createOtpRateLimiter({
      store: new InMemoryOtpRateLimitStore(),
      now: time.now,
      policy: 'verify',
    });
    const attempt = () => limiter.check({ email: 'user@example.com', ip: '203.0.113.7' });

    for (let i = 0; i < 5; i++) expect((await attempt()).allowed).toBe(true);
    expect((await attempt()).allowed).toBe(false);

    time.advance(15 * 60_000);
    expect((await attempt()).allowed).toBe(false);

    time.advance(1);
    expect((await attempt()).allowed).toBe(true);
  });

  it('keeps verify keys apart from request keys in a shared store', async () => {
    const store = new InMemoryOtpRateLimitStore();
    const salt = 'fixed-test-salt';
    const request = createOtpRateLimiter({ store, salt });
    const verify = createOtpRateLimiter({ store, salt, policy: 'verify' });

    for (let i = 0; i < OTP_RATE_LIMIT.email.limit; i++) {
      await request.check({ email: 'user@example.com', ip: '203.0.113.7' });
    }
    expect((await request.check({ email: 'user@example.com', ip: '203.0.113.7' })).allowed).toBe(
      false,
    );
    expect((await verify.check({ email: 'user@example.com', ip: '203.0.113.7' })).allowed).toBe(
      true,
    );
  });
});
