/**
 * The per-run, per-account token that authenticates the INCOMING agent
 * connection — the credential [ADR-0006](../../docs/adr/0006-mcpwn-is-the-mcp-server.md)
 * puts in place of the user's own key.
 *
 * THE SECURITY MODEL INVERTED, SO THE CREDENTIAL DID TOO. We do not call the
 * user's agent, so we hold no key of theirs and there is nothing of theirs to
 * leak. What we do instead is host an MCP endpoint and invite a stranger's agent
 * to connect to it, serving tools that are hostile by construction. That endpoint
 * is INBOUND ATTACK SURFACE with nothing real behind it, and this module is the
 * lock on its door: one token, one run, one account, expiring with the run.
 *
 * WHAT A LEAKED TOKEN IS WORTH, DELIBERATELY: one sandboxed run of fabricated
 * attack content. It is not an account credential, it cannot read another run, it
 * cannot be replayed after the run ends, and it dies on a wall clock even if the
 * run is abandoned. That bound is the point of the design, not a side effect.
 *
 * ── THE FORMAT: a split token, `rt_<selector>_<verifier>` ──
 *
 * A single opaque secret would force verification to either scan every stored
 * hash or index the secret itself. So the token carries two independent random
 * halves (the selector/verifier split, as used by Django's and Laravel's signed
 * token stores):
 *
 *   - SELECTOR — 16 random bytes as 32 lowercase hex chars. A LOOKUP KEY, not a
 *     secret: it is stored in the clear because it is what the index is on, and
 *     on its own it authenticates nothing.
 *   - VERIFIER — 32 random bytes as 64 lowercase hex chars, i.e. **256 bits** of
 *     `crypto.randomBytes` entropy. THE secret. Only its digest is stored.
 *
 * Both halves come from `node:crypto`'s CSPRNG. `Math.random` is not a candidate:
 * it is neither seeded nor generated for unpredictability, and a token an
 * attacker can reconstruct from a few observations is not a token.
 *
 * Hex with `_` separators, not base64url, ON PURPOSE: base64url's alphabet
 * CONTAINS `_`, so a `_`-separated base64url token has no unambiguous parse. Hex
 * costs a few characters and buys a grammar that is one anchored regex, has a
 * fixed length, and cannot be split two ways. The `rt_` prefix makes a leaked
 * token identifiable on sight (and greppable by secret scanners) without
 * revealing whose it is, and names no product: the token sits in the agent's own
 * MCP config, where a product name would tell the agent what it is talking to.
 *
 * Tokens issued before the rename (2026-10-08) carry the legacy `mcpwn_rt_`
 * prefix. They are accepted for ONE token lifetime and no longer: see
 * {@link LEGACY_RUN_TOKEN_PREFIX}.
 *
 * ── THE HASH: SHA-256, and why NOT a slow KDF ──
 *
 * The stored value is a single unsalted SHA-256 of the verifier. That is a
 * deliberate choice against the usual instinct, so here is the reasoning rather
 * than the default:
 *
 *   - A slow KDF (bcrypt / scrypt / Argon2) exists to make brute force expensive
 *     for LOW-ENTROPY, human-chosen secrets. This verifier is 256 uniformly
 *     random bits. There is no dictionary, no reuse, no shape to guess: brute
 *     force is already infeasible, and a work factor multiplies an infeasible
 *     number by a constant while multiplying our own per-request latency by the
 *     same constant.
 *   - That latency is not free HERE in particular. This credential is checked on
 *     an endpoint we openly invite unauthenticated strangers to hammer, so a
 *     deliberately expensive verification is a DoS amplifier pointed at us.
 *   - No salt, for the same reason: salts defeat precomputation across a
 *     guessable preimage space, and a uniform 256-bit space has none. Two tokens
 *     colliding is not a threat we can afford to worry about before the heat
 *     death of the universe.
 *   - What the digest IS for: making the stored row useless. A dump of this table
 *     yields no token that can be presented, which is the whole requirement
 *     ("never persisted in plaintext").
 *
 * If the verifier ever stops being high-entropy random — if anything
 * user-supplied is ever folded into it — this reasoning is void and the algorithm
 * must be revisited, which is why `algorithm` is recorded on every row.
 *
 * ── VERIFICATION: constant time, uniform refusal ──
 *
 * The digests are compared with `crypto.timingSafeEqual` on equal-length buffers,
 * so response time carries no information about how much of a guess was right.
 * A length mismatch (a corrupted stored digest) would make that call throw, so it
 * is checked first and fails CLOSED instead.
 *
 * Every refusal carries a typed {@link RunTokenError} with a machine-readable
 * `code` for OUR logs — and the SAME sentence, {@link RUN_TOKEN_REJECTION_MESSAGE},
 * for the wire. An unknown selector and a real selector with a forged verifier
 * are the same code, because telling them apart is exactly the oracle that lets
 * someone enumerate which halves of a token are real. Nothing in a refusal ever
 * confirms that a run, an account, or a token exists.
 *
 * ── EXPIRY IS BOUNDED ON TWO AXES ──
 *
 * 1. THE RUN ENDS. `endRun()` stamps `endedAt`, and a stamped record is dead
 *    regardless of the clock. This is the primary bound: the token is scoped to
 *    one run and it does not outlive it.
 * 2. THE WALL CLOCK. `expiresAt = issuedAt + ttl`. An abandoned run never reaches
 *    axis 1, so without this a token would live forever on an endpoint anyone can
 *    reach. Whichever bound trips first wins.
 *
 * Time is injected (`now`), never read implicitly inside a check, so the whole
 * lifecycle is tested deterministically without sleeping on a real clock.
 *
 * ── INTEGRATION POINT (deliberately not wired yet) ──
 *
 * This module is TESTED PURE LOGIC WITH NO PRODUCTION CALLER, following the
 * precedent `checkLiveRunAllowance()` set in `./allowance.ts`: the thing it
 * guards does not exist on `main`. Under ADR-0006 a live run means an agent
 * connecting to an MCP server WE host, and that server is unbuilt (plan.md B2).
 * Inventing a caller so the token had somewhere to live would make the wiring a
 * fiction, which is the one thing this repo does not do.
 *
 * When the live-run entry point lands, the two ends attach like this:
 *
 *   // /connect, after auth and AFTER checkLiveRunAllowance() grants the run
 *   const { token, record } = issueRunToken({ runId, userId: user.id });
 *   await tokenStore.save(record);
 *   return { endpoint: `${origin}/api/mcp/${runId}`, token };  // shown ONCE
 *
 *   // the hosted MCP endpoint, on every inbound request
 *   const decision = await verifyRunToken({
 *     store: tokenStore,
 *     presented: bearerFrom(request.headers),   // untrusted, straight off the wire
 *     runId,                                     // from the addressed URL
 *     userId: run.userId,                        // the account that run belongs to
 *   });
 *   if (!decision.valid) return unauthorized(RUN_TOKEN_REJECTION_MESSAGE);
 *
 *   // when the run finishes, or is stopped, or is swept
 *   await tokenStore.endRun(runId, new Date());
 *
 * The store lands on `supabase/migrations/0002_run_tokens.sql`, whose table has
 * RLS enabled and ZERO policies: no browser session can read it under any
 * circumstances, and only server-side code holding the service-role key reaches
 * it. Verification is server-side only; the plaintext token exists exactly once,
 * in the response to the issuing request, and is never rendered from storage
 * because storage cannot produce it.
 */
import { z } from 'zod';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ConfigError } from '@/config/env';
import type { Logger } from '@/lib/logger';

type Env = Record<string, string | undefined>;

// ── Format ──

/** Identifies a leaked token on sight (and to secret scanners) without naming an owner. */
export const RUN_TOKEN_PREFIX = 'rt';
/**
 * The prefix every token carried before the rename. Accepted, never issued, and
 * only while the token is younger than the longest lifetime a token can be given
 * ({@link RUN_TOKEN_TTL_BOUNDS}.max), so once that much time has passed since the
 * deploy no legacy token can verify and this can be removed.
 */
export const LEGACY_RUN_TOKEN_PREFIX = 'mcpwn_rt';
/** Lookup key. Unique, not secret. */
export const RUN_TOKEN_SELECTOR_BYTES = 16;
/** THE secret: 256 bits of CSPRNG output. */
export const RUN_TOKEN_VERIFIER_BYTES = 32;
/** Recorded per row so a future change of algorithm is a migration, not a guess. */
export const RUN_TOKEN_HASH_ALGORITHM = 'sha256' as const;

/** The complete wire grammar. Anchored and fixed-length: one token parses one way. */
export const RUN_TOKEN_PATTERN = new RegExp(
  `^(?:${RUN_TOKEN_PREFIX}|${LEGACY_RUN_TOKEN_PREFIX})_([0-9a-f]{${RUN_TOKEN_SELECTOR_BYTES * 2}})_([0-9a-f]{${RUN_TOKEN_VERIFIER_BYTES * 2}})$`,
);

// ── Refusal ──

/**
 * Why a connection was refused. These codes are for OUR logs and metrics; the
 * wire only ever sees {@link RUN_TOKEN_REJECTION_MESSAGE}.
 *
 * `UNKNOWN` deliberately covers BOTH "no record for that selector" and "the
 * verifier does not match a record we do hold". Separating them would answer the
 * one question an attacker wants answered.
 */
export type RunTokenRejectionCode =
  'MALFORMED' | 'UNKNOWN' | 'WRONG_RUN' | 'WRONG_ACCOUNT' | 'RUN_ENDED' | 'EXPIRED';

/**
 * The ONE sentence every refusal states, whatever the code. It tells an honest
 * operator what to check and tells an attacker nothing: it never confirms that a
 * run, an account, or a token exists.
 */
export const RUN_TOKEN_REJECTION_MESSAGE =
  'This run endpoint refused the connection. Use the endpoint and token issued ' +
  'for this run, and start a new run if this one has finished.';

/** A refusal, typed. Never carries the presented token, in any field. */
export class RunTokenError extends Error {
  /** Stable discriminator for server-side logging and metrics. */
  readonly code: RunTokenRejectionCode;

  constructor(code: RunTokenRejectionCode) {
    super(RUN_TOKEN_REJECTION_MESSAGE);
    this.name = 'RunTokenError';
    this.code = code;
  }
}

// ── TTL config ──

/**
 * Minutes. The floor is 1 because a zero TTL mints a token that is dead on
 * arrival; the ceiling is 24h because "scoped to one run" stops meaning anything
 * once a credential outlives the session it was issued for.
 */
export const RUN_TOKEN_TTL_BOUNDS = { min: 1, max: 1440 } as const;

/**
 * Long enough for a real agent to work a scenario, short enough that an abandoned
 * run's token is worthless by the time anyone finds it.
 */
export const DEFAULT_RUN_TOKEN_TTL_MINUTES = 60;

const TtlSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(RUN_TOKEN_TTL_BOUNDS.min).max(RUN_TOKEN_TTL_BOUNDS.max));

/**
 * How long a run token stays valid on the wall-clock axis. Env-only
 * (`RUN_TOKEN_TTL_MINUTES`), so the operator can shorten the blast radius without
 * a deploy. A set-but-invalid value throws a typed `ConfigError`: an expiry that
 * silently falls back to a number nobody chose is not an expiry policy.
 *
 * The accessor lives HERE rather than in `src/config/env.ts` because the module
 * has no production caller yet (see the integration note above). Hoisting a name
 * into the shared env schema would advertise operator configuration for a code
 * path that cannot be reached; it moves there with the MCP server that reads it.
 */
export function getRunTokenTtlMinutes(env: Env = process.env): number {
  const raw = env.RUN_TOKEN_TTL_MINUTES;
  if (raw === undefined) return DEFAULT_RUN_TOKEN_TTL_MINUTES;
  const result = TtlSchema.safeParse(raw);
  if (!result.success) {
    // Value-free, like every other config error in this codebase.
    throw new ConfigError(
      `Invalid RUN_TOKEN_TTL_MINUTES: expected an integer ` +
        `${RUN_TOKEN_TTL_BOUNDS.min}-${RUN_TOKEN_TTL_BOUNDS.max}.`,
    );
  }
  return result.data;
}

// ── Records + store ──

/**
 * What is persisted. NOT a token: the verifier appears only as a digest, so this
 * row cannot be turned back into a credential. The selector is in the clear on
 * purpose — it is the index, and it authenticates nothing by itself.
 */
export interface RunTokenRecord {
  /** Lookup key (hex). Not secret. */
  readonly selector: string;
  /** `sha256(verifier)` as hex. The verifier itself is never stored anywhere. */
  readonly verifierHash: string;
  /** Which digest produced `verifierHash`; recorded so rotation is possible. */
  readonly algorithm: typeof RUN_TOKEN_HASH_ALGORITHM;
  /** The ONE run this token opens. */
  readonly runId: string;
  /** The ONE account it belongs to. */
  readonly userId: string;
  /** ISO-8601. */
  readonly issuedAt: string;
  /** ISO-8601 wall-clock bound (axis 2). */
  readonly expiresAt: string;
  /** ISO-8601 once the run ended (axis 1); `null` while the run is open. */
  readonly endedAt: string | null;
}

/** What verification needs from persistence: one indexed read, nothing more. */
export interface RunTokenLookup {
  findBySelector(selector: string): Promise<RunTokenRecord | null>;
}

/** The full port: issue writes, verification reads, the run ending revokes. */
export interface RunTokenStore extends RunTokenLookup {
  save(record: RunTokenRecord): Promise<void>;
  /** Expire every token of a run, the moment that run ends (axis 1). */
  endRun(runId: string, endedAt: Date): Promise<void>;
}

/**
 * In-memory `RunTokenStore` — the offline/test adapter, mirroring
 * `InMemoryRunRepository`. The Supabase adapter belongs to the MCP-server slice
 * that will call this; the table it lands on is already specified in
 * `supabase/migrations/0002_run_tokens.sql`.
 */
export class InMemoryRunTokenStore implements RunTokenStore {
  private rows = new Map<string, RunTokenRecord>();

  async save(record: RunTokenRecord): Promise<void> {
    this.rows.set(record.selector, record);
  }

  async findBySelector(selector: string): Promise<RunTokenRecord | null> {
    return this.rows.get(selector) ?? null;
  }

  async endRun(runId: string, endedAt: Date): Promise<void> {
    for (const [selector, record] of this.rows) {
      // A run ends once. Re-stamping would push the revocation later, which is
      // the wrong direction for a control whose job is to close the window.
      if (record.runId === runId && record.endedAt === null) {
        this.rows.set(selector, { ...record, endedAt: endedAt.toISOString() });
      }
    }
  }
}

// ── Issue ──

// Both ids go through the SAME normalization verification applies (see
// `normalizeId`), so the two ends cannot drift apart.
const BoundIdSchema = z.string().transform(normalizeId).pipe(z.string().min(1));

const IssueSchema = z.object({ runId: BoundIdSchema, userId: BoundIdSchema });

export interface IssueRunTokenInput {
  /** The one run this token opens. */
  readonly runId: string;
  /** The one account it is issued to. */
  readonly userId: string;
  /** Injected clock. Defaults to now. */
  readonly now?: Date;
  /** Wall-clock lifetime in ms. Defaults to the configured TTL. */
  readonly ttlMs?: number;
  /** Environment the TTL is read from. Defaults to `process.env`. */
  readonly env?: Env;
  /** Optional structured logger. The token never reaches it. */
  readonly logger?: Logger;
}

/**
 * The plaintext token and the row that will verify it. The `token` field is the
 * ONLY time the credential exists in full: hand it to the user once, never log
 * it, never persist it, and never try to recover it from `record` (you cannot).
 */
export interface IssuedRunToken {
  readonly token: string;
  readonly record: RunTokenRecord;
}

/** Hex digest of the verifier. See the hash reasoning at the top of the file. */
function digest(verifier: string): string {
  return createHash(RUN_TOKEN_HASH_ALGORITHM).update(verifier).digest('hex');
}

/**
 * The ONE normalization the run and account ids get, applied identically when a
 * token is issued and when it is checked.
 *
 * It exists because a one-sided trim is a trap: issuing with `' run-1 '` would
 * store `'run-1'`, and checking with the same `' run-1 '` would then compare
 * unequal and refuse a token that is genuinely correct. That fails CLOSED, so it
 * is not a hole, but a credential that rejects its own owner over invisible
 * whitespace is a bug either way. Both ends go through here so the comparison is
 * symmetric by construction rather than by discipline.
 */
function normalizeId(id: string): string {
  return id.trim();
}

/**
 * Mint a per-run, per-account token. Pure apart from the CSPRNG: it writes
 * nothing, so the caller persists `record` (typically in the same transaction
 * that creates the run).
 *
 * Throws a typed {@link RunTokenError} on an unbound or dead-on-arrival request.
 * That IS a throw rather than a returned decision, unlike verification: an
 * unbound issue request is a programming error on our side, not an expected state
 * a stranger can provoke.
 */
export function issueRunToken(input: IssueRunTokenInput): IssuedRunToken {
  const parsed = IssueSchema.safeParse({ runId: input.runId, userId: input.userId });
  if (!parsed.success) throw new RunTokenError('MALFORMED');

  const ttlMs = input.ttlMs ?? getRunTokenTtlMinutes(input.env ?? process.env) * 60_000;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RunTokenError('EXPIRED');

  const issuedAt = input.now ?? new Date();
  const selector = randomBytes(RUN_TOKEN_SELECTOR_BYTES).toString('hex');
  const verifier = randomBytes(RUN_TOKEN_VERIFIER_BYTES).toString('hex');

  const record: RunTokenRecord = {
    selector,
    verifierHash: digest(verifier),
    algorithm: RUN_TOKEN_HASH_ALGORITHM,
    runId: parsed.data.runId,
    userId: parsed.data.userId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
    endedAt: null,
  };

  // Note what was issued, for whom, and until when. Not a byte of the token.
  input.logger?.info('run token issued', {
    runId: record.runId,
    userId: record.userId,
    expiresAt: record.expiresAt,
  });

  return { token: `${RUN_TOKEN_PREFIX}_${selector}_${verifier}`, record };
}

// ── Parse ──

/** Zod over the raw wire value: an unknown becomes a token only by matching the grammar. */
const PresentedSchema = z.string().regex(RUN_TOKEN_PATTERN);

/** The two halves of a well-formed token. */
export interface ParsedRunToken {
  readonly selector: string;
  readonly verifier: string;
  /** Carried the pre-rename prefix: verifiable only within one token lifetime. */
  readonly legacy: boolean;
}

/**
 * Parse an untrusted value into its halves, or `null`. Runs BEFORE any store read
 * and before any hashing, so garbage costs one regex and never touches the
 * database or the CPU budget of a digest.
 */
export function parseRunToken(presented: unknown): ParsedRunToken | null {
  const result = PresentedSchema.safeParse(presented);
  if (!result.success) return null;
  const match = RUN_TOKEN_PATTERN.exec(result.data);
  const [, selector, verifier] = match ?? [];
  // Both groups are non-optional in the pattern, so a match implies both are
  // present; the check is here because a narrowed type is cheaper to trust than
  // a comment, and a parser for hostile input should not need a non-null
  // assertion to compile.
  if (!selector || !verifier) return null;
  return { selector, verifier, legacy: result.data.startsWith(`${LEGACY_RUN_TOKEN_PREFIX}_`) };
}

// ── Verify ──

export interface VerifyRunTokenQuery {
  /** Where records are read from. */
  readonly store: RunTokenLookup;
  /** The value straight off the wire. Untrusted by name and by type. */
  readonly presented: unknown;
  /** The run whose endpoint was addressed. */
  readonly runId: string;
  /** The account that run belongs to. */
  readonly userId: string;
  /** Injected clock. Defaults to now. */
  readonly now?: Date;
  /** Optional structured logger. The token never reaches it. */
  readonly logger?: Logger;
}

export type RunTokenDecision =
  | { readonly valid: true; readonly record: RunTokenRecord }
  | { readonly valid: false; readonly error: RunTokenError };

/**
 * Constant-time digest comparison.
 *
 * `timingSafeEqual` THROWS on differing lengths, which would turn a corrupted
 * stored digest into a 500 on a public endpoint, so the length is checked first
 * and a mismatch fails closed. The length check itself leaks nothing: both
 * operands are digests of a fixed size, so an unequal length means our own row is
 * broken, not that a guess was close.
 */
function digestsMatch(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  if (expected.length === 0 || expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Authenticate an inbound connection against one run and one account.
 *
 * Never throws for any refusal a stranger can provoke: the answer is a decision
 * carrying a typed {@link RunTokenError}, the same shape `checkLiveRunAllowance`
 * returns, so a hostile request is a bounded state the endpoint states plainly
 * rather than an exception surfacing as a 500.
 *
 * Order of checks, deliberately: authenticity FIRST (grammar, then the record,
 * then the digest), and only then the bindings and the lifecycle. A caller that
 * cannot authenticate never advances far enough to learn whether a run exists,
 * whose it is, or whether it is still open.
 */
export async function verifyRunToken(query: VerifyRunTokenQuery): Promise<RunTokenDecision> {
  const now = query.now ?? new Date();

  const refuse = (code: RunTokenRejectionCode): RunTokenDecision => {
    // The run being addressed and the reason, for our own incident trail. No
    // part of the presented token, not even the selector: correlation is by run.
    query.logger?.warn('run token rejected', { runId: query.runId, code });
    return { valid: false, error: new RunTokenError(code) };
  };

  const parsed = parseRunToken(query.presented);
  if (!parsed) return refuse('MALFORMED');

  const record = await query.store.findBySelector(parsed.selector);
  // Same code as a forged verifier, on purpose — see RunTokenRejectionCode.
  if (!record) return refuse('UNKNOWN');
  if (!digestsMatch(record.verifierHash, digest(parsed.verifier))) return refuse('UNKNOWN');

  // Both bindings are checked independently. A token satisfying one and not the
  // other means issuance is broken, and the safe reading of a broken invariant is
  // to refuse rather than to trust whichever half agreed.
  if (record.runId !== normalizeId(query.runId)) return refuse('WRONG_RUN');
  if (record.userId !== normalizeId(query.userId)) return refuse('WRONG_ACCOUNT');

  // Axis 1: the run ended. A recorded end is final; there is no clock reading
  // that un-ends a run, so this does not consult `now` at all.
  if (record.endedAt !== null) return refuse('RUN_ENDED');

  // Axis 2: the wall clock, for the run that simply stopped being attended.
  if (now.getTime() >= new Date(record.expiresAt).getTime()) return refuse('EXPIRED');

  // The legacy prefix is honoured for one token lifetime at most, measured from
  // issue, whatever the stored expiry says. Every legacy token was issued before
  // the rename, so this bounds how long the old prefix can open anything at all.
  const lifetimeMs = RUN_TOKEN_TTL_BOUNDS.max * 60_000;
  if (parsed.legacy && now.getTime() >= new Date(record.issuedAt).getTime() + lifetimeMs) {
    return refuse('EXPIRED');
  }

  query.logger?.info('run token accepted', { runId: record.runId, userId: record.userId });
  return { valid: true, record };
}
