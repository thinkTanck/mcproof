/**
 * Sign-up rate limiting on the emailed-code path — an ABUSE BACKSTOP, not the
 * cost control.
 *
 * READ THIS FIRST, BECAUSE IT IS THE PART THAT IS EASY TO OVERSELL. The primary
 * control on operator spend is the per-account LIFETIME free allowance
 * ([ADR-0007](../../../docs/adr/0007-access-and-cost-model.md),
 * `src/runs/allowance.ts`): each account's total draw is bounded at creation, so
 * no single user can drain the shared pool. This module bounds nothing about
 * spend. It exists because a lifetime allowance makes ACCOUNT CREATION the
 * attack surface: an allowance that resets with a fresh address is not a
 * lifetime allowance. So the job here is narrow — make minting accounts cost
 * time — and it is defence in depth behind email verification, which is the
 * backstop that actually requires a deliverable address.
 *
 * ── WHAT IT KEYS ON, AND WHY NEITHER KEY IS SUFFICIENT ──
 *
 * BOTH the address and the source, as two independent buckets, refusing if
 * either is over. Stated honestly, each alone is weak in a different direction:
 *
 *   - EMAIL keying is trivially rotated. `a+1@`, `a+2@` and a fresh mailbox are
 *     free, so it stops nobody from minting accounts. What it does stop is
 *     mail-bombing ONE address (a real abuse of a send endpoint, and the one an
 *     unrelated victim feels), and it bounds the operator's outbound mail bill
 *     per address.
 *   - IP keying punishes shared NATs. A university, an office, a mobile carrier
 *     and a CGNAT pool are all one key, so a limit tight enough to stop a script
 *     is a limit that locks out real users sitting behind the same address. It
 *     is also cheap to evade with a proxy pool.
 *
 * So the IP bucket is deliberately LOOSE (it is the one that bites innocents)
 * and the email bucket is TIGHT (it is the one an individual user controls). The
 * combination raises the cost of automated sign-up from free to mildly annoying.
 * It does not make it hard, and it is not asked to.
 *
 * ── NOT AN ACCOUNT-ENUMERATION ORACLE ──
 *
 * The limiter runs BEFORE the provider and is never told whether an address is
 * registered — `signInWithOtp` with `shouldCreateUser: true` treats both the same
 * anyway — so its decision cannot vary with registration status. That is
 * structural, and it is asserted rather than promised.
 *
 * The refusal is the same reasoning `run-token.ts` applies to `UNKNOWN`: one
 * sentence on the wire, a machine-readable `scope` for our logs only. The
 * sentence is {@link RATE_LIMITED_MESSAGE} — byte-identical to the copy the
 * PROVIDER's own rate limit already renders — so a limiter refusal, a GoTrue
 * refusal, a registered address and an unregistered one are one indistinguishable
 * response. It names no address, no bucket, no count and no window, because a
 * refusal that says which bucket tripped tells a prober which key it is fighting.
 *
 * RESIDUAL, STATED RATHER THAN HIDDEN: a shared email bucket means a prober who
 * counts carefully can learn that SOMEONE recently requested a code for an
 * address (activity), which is weaker than learning the address is registered
 * (existence) and costs the prober real emails delivered to the victim on the way.
 * We accept that; the alternative — answering a limited request with a fake
 * success — would lie to the legitimate user who tripped their own limit.
 *
 * ── FAIL CLOSED, AND WHERE IT DELIBERATELY DOES NOT ──
 *
 * A limiter that cannot read its own state does not know whether this is the
 * first request or the thousandth, so it refuses. The one place that inverts is
 * CAPACITY: when the in-memory store is full it evicts its oldest key rather than
 * refusing, because refusing would hand an attacker a total sign-in outage for
 * the price of a few thousand requests, and the allowance still bounds spend.
 *
 * ── THE NUMBERS ARE CODE, NOT OPERATOR CONFIG ──
 *
 * Unlike `LIVE_RUN_ALLOWANCE` (a product-facing number a human reads) these
 * limits are internal tuning for a backstop, so they are constants with a stated
 * rationale rather than env knobs nobody would ever set. They are injectable for
 * tests, and the sentence a user sees derives from no numeral at all.
 *
 * ── THE COUNTERS ARE DURABLE NOW, AND THE KEY IS WHY THAT WORKS ──
 *
 * This module used to record the limit's own defect: state lived in the process,
 * which on serverless means PER INSTANCE, so the effective limit was the constant
 * times however many instances were warm. The number in the code was not the
 * number the internet met.
 *
 * {@link resolveOtpRateLimiter} now picks a Supabase-backed
 * {@link OtpRateLimitStore} whenever Supabase is configured, on exactly the test
 * `getRunRepository()` uses, with the in-memory store as the offline fallback.
 * Moving the rows was only half of it: the bucket KEY is a salted digest, and a
 * per-process salt would have given every instance its own private bucket inside
 * the shared table, multiplying the limit exactly as before with a database bill
 * attached. So the salt is injected, and the durable path derives ONE salt that
 * every instance computes identically (see {@link resolveOtpRateLimiter}).
 *
 * The platform firewall's rate limiting still sits in front of all of it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getSupabaseConfig, getSupabaseServiceRoleKey } from '@/config/env';
import { BAD_EMAIL_MESSAGE, RATE_LIMITED_MESSAGE } from '@/lib/auth/errors';
import { createAdminSupabase } from '@/lib/supabase/server';
import { SupabaseOtpRateLimitStore } from '@/lib/auth/otp-rate-limit.supabase';

/**
 * The two buckets.
 *
 * EMAIL 4 per 15 minutes: the sign-in panel sends one code and offers a resend on
 * a 45-second cooldown, so a determined-but-legitimate user reaches three inside
 * a couple of minutes. Four leaves headroom and still bounds mail to one address.
 *
 * IP 15 per hour: loose on purpose. It has to pass a shared office or campus
 * exit address doing ordinary sign-ins, while still turning "mint accounts in a
 * loop" into "mint fifteen, then wait".
 */
export const OTP_RATE_LIMIT = {
  email: { limit: 4, windowMs: 15 * 60_000 },
  ip: { limit: 15, windowMs: 60 * 60_000 },
} as const;

/**
 * The two buckets for ENTERING a code (2026-10-14, security lane S1e).
 *
 * Sign-in runs on the server, so every code check reaches Supabase from the
 * deployment's own addresses, shared by every user, and Supabase's per-IP limit
 * on verification counts them all together. Without a limit of our own, one
 * person guessing codes could use that up and block code entry for everyone.
 *
 * EMAIL 5 per 15 minutes: a code that was mistyped, then pasted with a stray
 * character, then typed again is three; five leaves room and still makes
 * guessing an 8-digit code hopeless.
 *
 * IP 20 per 15 minutes: four people behind one office address each using their
 * full five, and well under Supabase's shared verification limit even though a
 * mismatched code costs two provider calls.
 *
 * These keys live under their own names (`verify-email`, `verify-ip`), so a run
 * of wrong codes never stops anyone asking for a new one, and a full request
 * count never stops anyone entering the code they already have.
 */
export const OTP_VERIFY_RATE_LIMIT = {
  email: { limit: 5, windowMs: 15 * 60_000 },
  ip: { limit: 20, windowMs: 15 * 60_000 },
} as const;

/** Which of the two limits a limiter enforces: sending a code, or entering one. */
export type OtpRateLimitPolicy = 'request' | 'verify';

const POLICIES = {
  request: { rules: OTP_RATE_LIMIT, prefix: '' },
  verify: { rules: OTP_VERIFY_RATE_LIMIT, prefix: 'verify-' },
} as const;

/**
 * Why the send was refused. For OUR logs and metrics; the wire sees only the
 * sentence. `address` is the one scope that is not a rate decision at all: the
 * value could not be bucketed, so it could not be counted, so it is refused.
 */
export type OtpRateLimitScope = 'email' | 'ip' | 'store' | 'address';

/**
 * A refusal, typed.
 *
 * EVERY RATE REFUSAL STATES ONE SENTENCE — {@link RATE_LIMITED_MESSAGE}, the copy
 * the provider's own rate limit already renders — so an attacker cannot tell our
 * limiter from GoTrue's, cannot tell which bucket tripped, and cannot tell a
 * registered address from an unregistered one.
 *
 * The `address` scope is the deliberate exception, and it is not an oracle:
 * whether a string is a syntactically usable address is decidable by anyone
 * holding the string, so saying so reveals nothing we hold. Answering "too many
 * attempts" to a first-ever typo would be a lie told for no security gain.
 */
export class OtpRateLimitError extends Error {
  readonly code = 'OTP_RATE_LIMITED' as const;
  readonly scope: OtpRateLimitScope;

  constructor(scope: OtpRateLimitScope) {
    super(scope === 'address' ? BAD_EMAIL_MESSAGE : RATE_LIMITED_MESSAGE);
    this.name = 'OtpRateLimitError';
    this.scope = scope;
  }
}

export type OtpRateLimitDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly error: OtpRateLimitError };

/**
 * What the limiter needs from state: count the hits inside a window, and record
 * one. Two methods rather than a combined "hit and count" because REFUSED
 * attempts are deliberately not recorded — see {@link createOtpRateLimiter}.
 */
export interface OtpRateLimitStore {
  countSince(key: string, since: number): Promise<number>;
  record(key: string, at: number): Promise<void>;
}

/**
 * The longest window any bucket uses. It is what a durable row's own expiry is
 * measured from: a hit older than this can never be counted by any bucket, so it
 * is safe to delete.
 */
export const OTP_RATE_LIMIT_MAX_WINDOW_MS = Math.max(
  OTP_RATE_LIMIT.email.windowMs,
  OTP_RATE_LIMIT.ip.windowMs,
  OTP_VERIFY_RATE_LIMIT.email.windowMs,
  OTP_VERIFY_RATE_LIMIT.ip.windowMs,
);

/** Guard against a hostile header becoming an unbounded map key. */
const IpSchema = z
  .string()
  .trim()
  .min(3)
  .max(45)
  .regex(/^[0-9a-fA-F:.]+$/);

/**
 * The client address, from the proxy headers Vercel sets. Returns `null` when
 * nothing usable is present, which the limiter treats as one shared bucket
 * rather than as a reason to skip the check.
 */
export function clientIpFromHeaders(headers: { get(name: string): string | null }): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0];
  const candidate = forwarded ?? headers.get('x-real-ip') ?? '';
  const parsed = IpSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Enough of an address to bucket, and no more.
 *
 * Bounded at the RFC's practical ceiling so a megabyte of "address" is refused
 * before it is ever hashed into a key, and lower-cased so the count follows the
 * person rather than the capitalization. It deliberately does NOT judge SYNTAX:
 * GoTrue is the authority on what is deliverable, and a local regex that
 * disagrees with it would lock out a legitimate address for a rule we invented.
 */
const EmailSchema = z.string().trim().toLowerCase().min(3).max(254);

/**
 * In-memory {@link OtpRateLimitStore}: hit timestamps per key, pruned on access.
 *
 * BOUNDED ON PURPOSE. An unbounded map is its own denial of service, so the key
 * count is capped and the oldest key is evicted when the cap is reached. That is
 * the one fail-OPEN choice in this module and it is the right one: the
 * alternative lets an attacker close sign-in for everybody by filling the table.
 */
export class InMemoryOtpRateLimitStore implements OtpRateLimitStore {
  private hits = new Map<string, number[]>();
  private readonly maxKeys: number;

  constructor(options: { maxKeys?: number } = {}) {
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  async countSince(key: string, since: number): Promise<number> {
    const kept = (this.hits.get(key) ?? []).filter((at) => at >= since);
    if (kept.length === 0) this.hits.delete(key);
    else this.hits.set(key, kept);
    return kept.length;
  }

  async record(key: string, at: number): Promise<void> {
    const existing = this.hits.get(key);
    if (existing) {
      existing.push(at);
      return;
    }
    // Map iteration is insertion-ordered, so the first key is the oldest.
    while (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
    this.hits.set(key, [at]);
  }

  /** The keys currently held. Digests only, by construction. */
  keys(): string[] {
    return [...this.hits.keys()];
  }

  /** Drop all state. Used by tests, and available as an operator clear. */
  reset(): void {
    this.hits.clear();
  }
}

export interface OtpRateLimiterOptions {
  readonly store?: OtpRateLimitStore;
  /** Injected clock, so nothing in the tests sleeps. */
  readonly now?: () => Date;
  /**
   * The salt bucket keys are digested with. Defaults to the per-process random
   * salt, which is right for a store that dies with the process and WRONG for a
   * shared one — every instance must derive the same key or the limit multiplies.
   */
  readonly salt?: string;
  /** Sending a code (the default) or entering one. Each has its own buckets. */
  readonly policy?: OtpRateLimitPolicy;
}

export interface OtpRateLimitRequest {
  readonly email: string;
  readonly ip: string | null;
}

export interface OtpRateLimiter {
  check(request: OtpRateLimitRequest): Promise<OtpRateLimitDecision>;
}

/**
 * A per-process salt, so limiter keys are digests that cannot be reversed into
 * the addresses and source addresses they came from. A dump of limiter state is
 * therefore a list of opaque strings: it can say how many requests a key made,
 * never whose. It is random per process because the state does not outlive the
 * process either, so a stable salt would buy nothing and keep a correlatable
 * value around.
 */
const PROCESS_KEY_SALT = randomBytes(16).toString('hex');

const bucketKey = (salt: string, scope: string, value: string): string =>
  `${scope}:${createHash('sha256').update(`${salt}:${scope}:${value}`).digest('hex')}`;

/**
 * Build a limiter over the given state and clock.
 *
 * REFUSED ATTEMPTS ARE NOT RECORDED. Counting them would let a caller extend
 * their own lockout indefinitely by retrying, which punishes the impatient
 * legitimate user far more than the attacker who simply waits. The window
 * therefore drains on a schedule the user can predict.
 */
export function createOtpRateLimiter(options: OtpRateLimiterOptions = {}): OtpRateLimiter {
  const store = options.store ?? new InMemoryOtpRateLimitStore();
  const now = options.now ?? (() => new Date());
  const salt = options.salt ?? PROCESS_KEY_SALT;
  const { rules, prefix } = POLICIES[options.policy ?? 'request'];

  const refuse = (scope: OtpRateLimitScope): OtpRateLimitDecision => ({
    allowed: false,
    error: new OtpRateLimitError(scope),
  });

  return {
    async check(request: OtpRateLimitRequest): Promise<OtpRateLimitDecision> {
      const email = EmailSchema.safeParse(request.email);
      // An unbucketable address is an uncountable one, so it is refused here
      // rather than passed on uncounted.
      if (!email.success) return refuse('address');

      const at = now().getTime();
      const buckets = [
        {
          scope: 'email' as const,
          key: bucketKey(salt, `${prefix}email`, email.data),
          rule: rules.email,
        },
        {
          scope: 'ip' as const,
          key: bucketKey(salt, `${prefix}ip`, request.ip ?? 'unknown'),
          rule: rules.ip,
        },
      ];

      try {
        for (const bucket of buckets) {
          const used = await store.countSince(bucket.key, at - bucket.rule.windowMs);
          if (used >= bucket.rule.limit) return refuse(bucket.scope);
        }
        for (const bucket of buckets) await store.record(bucket.key, at);
      } catch {
        // Fail closed: state we cannot read is state we cannot trust. The reason
        // is swallowed rather than attached, because it is the store's problem
        // and the caller is a stranger.
        return refuse('store');
      }

      return { allowed: true };
    },
  };
}

/**
 * The offline/test counters. A module singleton because the state IS the control:
 * a per-request in-memory limiter would count every request as the first.
 */
export const otpRateLimitStore = new InMemoryOtpRateLimitStore();

/** The offline limiter, over the process-local counters and the process salt. */
const processLimiter = createOtpRateLimiter({ store: otpRateLimitStore });

/** The offline code-entry limiter: the same counters, under its own key names. */
const processVerifyLimiter = createOtpRateLimiter({
  store: otpRateLimitStore,
  policy: 'verify',
});

/**
 * Label mixed into the durable salt, so the same secret used for another purpose
 * one day cannot produce the same digests as this one.
 */
const DURABLE_SALT_LABEL = 'mcpwn/otp-rate-limit/v1';

/**
 * THE DURABLE SALT — derived, not configured, and not stored beside the digests.
 *
 * Three options were on the table and two are worse:
 *
 *   - A CONSTANT in the source. Useless: this repository is public, so anyone
 *     holding a dump of the table holds the salt too and can walk a list of
 *     addresses straight back to the buckets.
 *   - A ROW IN THE SAME DATABASE. Also weak, and in a way that is easy to miss:
 *     one dump would then carry the salt AND the digests, which is the precise
 *     thing salting is meant to prevent.
 *   - DERIVED FROM THE SERVICE-ROLE KEY, which is what this does. That key is
 *     already required to reach these tables at all, it is identical on every
 *     instance (so every instance computes the same bucket), and it lives in the
 *     deployment's configuration rather than in the database — so a database dump
 *     alone reverses nothing. The digest is one-way: the key is not recoverable
 *     from it, is never stored, and is never logged.
 *
 * The stated consequence: rotating the service-role key rotates the salt, which
 * empties every in-flight rate window. A 15-minute window resetting during a
 * planned rotation is a fair price, and it fails in the harmless direction.
 */
function durableSalt(adminSecret: string): string {
  return createHash('sha256').update(`${DURABLE_SALT_LABEL}:${adminSecret}`).digest('hex');
}

/**
 * Pick the counters the same way every other store in this codebase is picked:
 * purely on whether Supabase is configured. There is no driver switch, because a
 * driver switch is a way to deploy the wrong store by typo.
 *
 * It resolves per call rather than caching, matching `getRunRepository()`. The
 * cost is one client object on a path that is about to send an email.
 *
 * FALLBACK, DELIBERATE: if Supabase is configured but the admin credential is
 * missing or unusable, this returns the in-memory limiter instead of throwing.
 * A misconfigured deployment then has a weaker limit rather than no sign-in at
 * all, which is the same direction this module already chose when it evicts
 * rather than refuses at capacity. It is an operator error either way, and the
 * lifetime allowance still bounds spend.
 */
export function resolveOtpRateLimiter(policy: OtpRateLimitPolicy = 'request'): OtpRateLimiter {
  const fallback = policy === 'verify' ? processVerifyLimiter : processLimiter;
  try {
    if (!getSupabaseConfig()) return fallback;
    const client = createAdminSupabase();
    const adminSecret = getSupabaseServiceRoleKey();
    if (!client || !adminSecret) return fallback;
    return createOtpRateLimiter({
      store: new SupabaseOtpRateLimitStore(client),
      salt: durableSalt(adminSecret),
      policy,
    });
  } catch {
    return fallback;
  }
}

/**
 * The limiter the sign-in path uses. It delegates on every call so the store is
 * chosen from the running configuration rather than from whatever was true when
 * this module happened to be imported.
 */
export const otpRateLimiter: OtpRateLimiter = {
  check: (request: OtpRateLimitRequest) => resolveOtpRateLimiter().check(request),
};

/**
 * The limiter the code-entry path uses ({@link OTP_VERIFY_RATE_LIMIT}), chosen
 * the same way and kept in the same table under its own key names.
 */
export const otpVerifyRateLimiter: OtpRateLimiter = {
  check: (request: OtpRateLimitRequest) => resolveOtpRateLimiter('verify').check(request),
};
