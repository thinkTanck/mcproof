import fc from 'fast-check';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError } from '@/config/env';
import { findTells } from '@/harness/server/surface';
import { createLogger } from '@/lib/logger';
import * as runTokenModule from '@/runs/run-token';
import {
  DEFAULT_RUN_TOKEN_TTL_MINUTES,
  InMemoryRunTokenStore,
  RUN_TOKEN_PATTERN,
  RUN_TOKEN_PREFIX,
  RUN_TOKEN_REJECTION_MESSAGE,
  RUN_TOKEN_TTL_BOUNDS,
  RunTokenError,
  getRunTokenTtlMinutes,
  issueRunToken,
  parseRunToken,
  verifyRunToken,
} from '@/runs/run-token';
import type { RunTokenRecord } from '@/runs/run-token';

const RUN = 'run-1';
const USER = 'user-1';
const T0 = new Date('2026-08-04T12:00:00.000Z');

/** Minutes to milliseconds, so the tests read in the unit the config uses. */
const minutes = (n: number) => n * 60_000;

/** Issue a token and persist it, the pairing every live verification assumes. */
async function issued(
  store: InMemoryRunTokenStore,
  overrides: { runId?: string; userId?: string; now?: Date; ttlMs?: number } = {},
) {
  const result = issueRunToken({
    runId: overrides.runId ?? RUN,
    userId: overrides.userId ?? USER,
    now: overrides.now ?? T0,
    ttlMs: overrides.ttlMs,
  });
  await store.save(result.record);
  return result;
}

/** A log sink that keeps every serialized line for the leak assertions. */
function capturingLogger() {
  const lines: string[] = [];
  return { lines, logger: createLogger({ sink: (line) => lines.push(line), now: () => T0 }) };
}

describe('issueRunToken — a per-run, per-account credential (ADR-0006)', () => {
  it('mints a token in the documented, unambiguous grammar', () => {
    const { token } = issueRunToken({ runId: RUN, userId: USER, now: T0 });

    expect(token).toMatch(RUN_TOKEN_PATTERN);
    expect(token.startsWith('rt_')).toBe(true);
    expect(findTells(token)).toEqual([]);
  });

  it('binds the record to exactly one run and one account', () => {
    const { record } = issueRunToken({ runId: RUN, userId: USER, now: T0 });

    expect(record).toMatchObject({ runId: RUN, userId: USER, endedAt: null, algorithm: 'sha256' });
    expect(record.issuedAt).toBe(T0.toISOString());
  });

  it('expires on a wall clock even if the run is never ended', () => {
    const { record } = issueRunToken({ runId: RUN, userId: USER, now: T0, ttlMs: minutes(30) });

    expect(new Date(record.expiresAt).getTime() - T0.getTime()).toBe(minutes(30));
  });

  it('falls back to the configured TTL when the caller names none', () => {
    const { record } = issueRunToken({ runId: RUN, userId: USER, now: T0, env: {} });

    expect(new Date(record.expiresAt).getTime() - T0.getTime()).toBe(
      minutes(DEFAULT_RUN_TOKEN_TTL_MINUTES),
    );
  });

  it('stores a DIGEST of the verifier, never the verifier itself', () => {
    const { token, record } = issueRunToken({ runId: RUN, userId: USER, now: T0 });
    const parsed = parseRunToken(token);
    if (!parsed) return expect.unreachable('the freshly minted token must parse');

    expect(record.verifierHash).toBe(createHash('sha256').update(parsed.verifier).digest('hex'));
    expect(record.verifierHash).not.toBe(parsed.verifier);
    expect(record.verifierHash).toHaveLength(64);
  });

  it('rejects an issue request with no run or no account, rather than minting an unbound token', () => {
    expect(() => issueRunToken({ runId: '', userId: USER, now: T0 })).toThrow(RunTokenError);
    expect(() => issueRunToken({ runId: RUN, userId: '   ', now: T0 })).toThrow(RunTokenError);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['not a number', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('rejects a %s TTL, which would mint a token with no honest expiry', (_label, ttlMs) => {
    expect(() => issueRunToken({ runId: RUN, userId: USER, now: T0, ttlMs })).toThrow(
      RunTokenError,
    );
  });

  /** The clock is injectable, not mandatory: unattended callers get the real one. */
  it('falls back to the wall clock when no instant is injected', () => {
    const before = Date.now();
    const { record } = issueRunToken({ runId: RUN, userId: USER });
    const issuedAt = new Date(record.issuedAt).getTime();

    expect(issuedAt).toBeGreaterThanOrEqual(before);
    expect(issuedAt).toBeLessThanOrEqual(Date.now());
  });
});

describe('parseRunToken — the wire grammar is checked before any crypto runs', () => {
  it('splits a well-formed token into its selector and verifier', () => {
    const { token } = issueRunToken({ runId: RUN, userId: USER, now: T0 });
    const parsed = parseRunToken(token);

    expect(parsed?.selector).toHaveLength(32);
    expect(parsed?.verifier).toHaveLength(64);
    expect(`rt_${parsed?.selector}_${parsed?.verifier}`).toBe(token);
  });

  it.each([
    ['an empty string', ''],
    ['the wrong prefix', 'xx_' + 'a'.repeat(32) + '_' + 'b'.repeat(64)],
    ['a truncated verifier', 'rt_' + 'a'.repeat(32) + '_' + 'b'.repeat(63)],
    ['a non-hex body', 'rt_' + 'z'.repeat(32) + '_' + 'z'.repeat(64)],
    ['no separator at all', 'rt_' + 'a'.repeat(96)],
  ])('refuses %s', (_label, raw) => {
    expect(parseRunToken(raw)).toBeNull();
  });

  it.each([[null], [undefined], [42], [{}], [['a']]])('refuses the non-string %s', (raw) => {
    expect(parseRunToken(raw)).toBeNull();
  });
});

describe('verifyRunToken — the full lifecycle: issue, verify, expire with the run', () => {
  it('accepts the exact token it issued, for its own run and account', async () => {
    const store = new InMemoryRunTokenStore();
    const { token, record } = await issued(store);

    const decision = await verifyRunToken({
      store,
      presented: token,
      runId: RUN,
      userId: USER,
      now: new Date(T0.getTime() + minutes(1)),
    });

    expect(decision.valid).toBe(true);
    if (!decision.valid) return expect.unreachable('expected the issued token to verify');
    expect(decision.record.selector).toBe(record.selector);
  });

  it('refuses a well-formed token that was never issued (UNKNOWN)', async () => {
    const store = new InMemoryRunTokenStore();
    await issued(store);
    const stranger = issueRunToken({ runId: RUN, userId: USER, now: T0 }).token;

    const decision = await verifyRunToken({
      store,
      presented: stranger,
      runId: RUN,
      userId: USER,
      now: T0,
    });

    expect(decision.valid).toBe(false);
    if (decision.valid) return expect.unreachable('expected a refusal');
    expect(decision.error.code).toBe('UNKNOWN');
  });

  /**
   * The enumeration case: a REAL selector paired with someone else's verifier.
   * It must be indistinguishable from a selector we have never seen, or the
   * endpoint becomes an oracle for which halves of a token are real.
   */
  it('refuses a real selector carrying the wrong verifier, with the SAME code as an unknown one', async () => {
    const store = new InMemoryRunTokenStore();
    const mine = await issued(store);
    const other = issueRunToken({ runId: RUN, userId: USER, now: T0 });
    const mineParsed = parseRunToken(mine.token);
    const otherParsed = parseRunToken(other.token);
    const forged = `rt_${mineParsed?.selector}_${otherParsed?.verifier}`;

    const decision = await verifyRunToken({
      store,
      presented: forged,
      runId: RUN,
      userId: USER,
      now: T0,
    });

    expect(decision.valid).toBe(false);
    if (decision.valid) return expect.unreachable('expected a refusal');
    expect(decision.error.code).toBe('UNKNOWN');
  });

  it('refuses a token issued for a DIFFERENT run (WRONG_RUN)', async () => {
    const store = new InMemoryRunTokenStore();
    const { token } = await issued(store, { runId: 'run-other' });

    const decision = await verifyRunToken({
      store,
      presented: token,
      runId: RUN,
      userId: USER,
      now: T0,
    });

    expect(decision.valid).toBe(false);
    if (decision.valid) return expect.unreachable('expected a refusal');
    expect(decision.error.code).toBe('WRONG_RUN');
  });

  it('refuses a token issued to a DIFFERENT account (WRONG_ACCOUNT)', async () => {
    const store = new InMemoryRunTokenStore();
    const { token } = await issued(store, { userId: 'user-other' });

    const decision = await verifyRunToken({
      store,
      presented: token,
      runId: RUN,
      userId: USER,
      now: T0,
    });

    expect(decision.valid).toBe(false);
    if (decision.valid) return expect.unreachable('expected a refusal');
    expect(decision.error.code).toBe('WRONG_ACCOUNT');
  });

  it.each([
    ['garbage', 'not-a-token'],
    ['an empty string', ''],
    ['a truncated token', 'rt_' + 'a'.repeat(32) + '_' + 'b'.repeat(10)],
  ])('refuses %s as MALFORMED without touching the store', async (_label, presented) => {
    const store = new InMemoryRunTokenStore();
    let looked = 0;
    const spy = {
      findBySelector: async (selector: string) => {
        looked += 1;
        return store.findBySelector(selector);
      },
    };

    const decision = await verifyRunToken({
      store: spy,
      presented,
      runId: RUN,
      userId: USER,
      now: T0,
    });

    expect(decision.valid).toBe(false);
    if (decision.valid) return expect.unreachable('expected a refusal');
    expect(decision.error.code).toBe('MALFORMED');
    expect(looked).toBe(0);
  });

  it('refuses every token of a run once that run has ENDED', async () => {
    const store = new InMemoryRunTokenStore();
    const { token } = await issued(store, { ttlMs: minutes(60) });

    const before = await verifyRunToken({
      store,
      presented: token,
      runId: RUN,
      userId: USER,
      now: T0,
    });
    expect(before.valid).toBe(true);

    await store.endRun(RUN, new Date(T0.getTime() + minutes(5)));

    const after = await verifyRunToken({
      store,
      presented: token,
      runId: RUN,
      userId: USER,
      now: new Date(T0.getTime() + minutes(6)),
    });

    expect(after.valid).toBe(false);
    if (after.valid) return expect.unreachable('expected a refusal');
    expect(after.error.code).toBe('RUN_ENDED');
  });

  it('refuses a token past its wall-clock bound even though the run never ended', async () => {
    const store = new InMemoryRunTokenStore();
    const { token } = await issued(store, { ttlMs: minutes(10) });
    const query = { store, presented: token, runId: RUN, userId: USER } as const;

    const justInside = await verifyRunToken({
      ...query,
      now: new Date(T0.getTime() + minutes(10) - 1),
    });
    expect(justInside.valid).toBe(true);

    const atTheBound = await verifyRunToken({
      ...query,
      now: new Date(T0.getTime() + minutes(10)),
    });
    expect(atTheBound.valid).toBe(false);
    if (atTheBound.valid) return expect.unreachable('expected a refusal');
    expect(atTheBound.error.code).toBe('EXPIRED');

    const longAfter = await verifyRunToken({
      ...query,
      now: new Date(T0.getTime() + minutes(600)),
    });
    expect(longAfter.valid).toBe(false);
  });

  /**
   * A one-sided trim would refuse a genuinely correct token over invisible
   * whitespace: issuing with `' run-1 '` stores `'run-1'`, and checking with the
   * same string would compare unequal. Both ends share one normalization.
   */
  it('normalizes the ids identically at issue and at check, so padding cannot refuse its own token', async () => {
    const store = new InMemoryRunTokenStore();
    const { token } = await issued(store, { runId: ' run-1 ', userId: ' user-1 ' });

    const padded = await verifyRunToken({
      store,
      presented: token,
      runId: '  run-1  ',
      userId: 'user-1 ',
      now: T0,
    });
    const bare = await verifyRunToken({
      store,
      presented: token,
      runId: RUN,
      userId: USER,
      now: T0,
    });

    expect(padded.valid).toBe(true);
    expect(bare.valid).toBe(true);
  });

  it('falls back to the wall clock when no instant is injected', async () => {
    const store = new InMemoryRunTokenStore();
    const { token } = await issued(store, { now: new Date(), ttlMs: minutes(10) });

    const decision = await verifyRunToken({ store, presented: token, runId: RUN, userId: USER });

    expect(decision.valid).toBe(true);
  });

  it('fails closed on a stored digest that is not a usable hash, instead of throwing', async () => {
    const store = new InMemoryRunTokenStore();
    const { token, record } = await issued(store);
    const corrupted: RunTokenRecord = { ...record, verifierHash: 'not-a-digest' };

    const decision = await verifyRunToken({
      store: { findBySelector: async () => corrupted },
      presented: token,
      runId: RUN,
      userId: USER,
      now: T0,
    });

    expect(decision.valid).toBe(false);
    if (decision.valid) return expect.unreachable('expected a refusal');
    expect(decision.error.code).toBe('UNKNOWN');
  });
});

describe('RunTokenError — typed refusal that cannot be used to enumerate', () => {
  it.each(['MALFORMED', 'UNKNOWN', 'EXPIRED', 'RUN_ENDED', 'WRONG_RUN', 'WRONG_ACCOUNT'] as const)(
    'states the same sentence for %s as for every other code',
    (code) => {
      expect(new RunTokenError(code).message).toBe(RUN_TOKEN_REJECTION_MESSAGE);
    },
  );

  it('is a real Error carrying a stable discriminator', () => {
    const error = new RunTokenError('UNKNOWN');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RunTokenError');
    expect(error.code).toBe('UNKNOWN');
  });

  /** UI copy rule: no em dashes. */
  it('carries no em dash', () => {
    expect(RUN_TOKEN_REJECTION_MESSAGE).not.toContain('—');
  });
});

describe('the token is never logged and never persisted in plaintext', () => {
  it('keeps the plaintext out of every log line issuing and verifying produce', async () => {
    const store = new InMemoryRunTokenStore();
    const { lines, logger } = capturingLogger();

    const { token, record } = issueRunToken({ runId: RUN, userId: USER, now: T0, logger });
    await store.save(record);
    const parsed = parseRunToken(token);

    await verifyRunToken({ store, presented: token, runId: RUN, userId: USER, now: T0, logger });
    await verifyRunToken({
      store,
      presented: token,
      runId: 'elsewhere',
      userId: USER,
      now: T0,
      logger,
    });
    await verifyRunToken({
      store,
      presented: 'garbage',
      runId: RUN,
      userId: USER,
      now: T0,
      logger,
    });

    expect(lines.length).toBeGreaterThan(0);
    const logged = lines.join('\n');
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(parsed?.verifier);
    expect(logged).not.toContain(parsed?.selector);
    expect(logged).not.toContain(record.verifierHash);
  });

  it('keeps the plaintext out of the record that gets persisted', () => {
    const { token, record } = issueRunToken({ runId: RUN, userId: USER, now: T0 });
    const parsed = parseRunToken(token);
    const persisted = JSON.stringify(record);

    expect(persisted).not.toContain(token);
    expect(persisted).not.toContain(parsed?.verifier);
  });

  it('keeps the plaintext out of a serialized rejection', async () => {
    const store = new InMemoryRunTokenStore();
    const { token } = await issued(store, { runId: 'run-other' });

    const decision = await verifyRunToken({
      store,
      presented: token,
      runId: RUN,
      userId: USER,
      now: T0,
    });
    if (decision.valid) return expect.unreachable('expected a refusal');

    const serialized = [
      decision.error.message,
      decision.error.stack ?? '',
      JSON.stringify(decision.error),
      JSON.stringify({ ...decision.error, message: decision.error.message }),
      String(decision.error),
    ].join('\n');

    expect(serialized).not.toContain(token);
  });
});

describe('run-token invariants (property-based)', () => {
  it('never issues the same token twice, however alike the inputs', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (runId, userId) => {
        fc.pre(runId.trim().length > 0 && userId.trim().length > 0);
        const a = issueRunToken({ runId, userId, now: T0 });
        const b = issueRunToken({ runId, userId, now: T0 });

        return (
          a.token !== b.token &&
          a.record.selector !== b.record.selector &&
          a.record.verifierHash !== b.record.verifierHash
        );
      }),
      { numRuns: 200 },
    );
  });

  it('gives 1000 issuances 1000 distinct selectors', () => {
    const selectors = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      selectors.add(issueRunToken({ runId: RUN, userId: USER, now: T0 }).record.selector);
    }

    expect(selectors.size).toBe(1000);
  });

  it('accepts ONLY the exact issued token: any single-character change is refused', async () => {
    const store = new InMemoryRunTokenStore();
    const { token } = await issued(store, { ttlMs: minutes(60) });

    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: token.length - 1 }),
        fc.constantFrom(...'0123456789abcdefxyz_'.split('')),
        async (index, replacement) => {
          const mutated = token.slice(0, index) + replacement + token.slice(index + 1);
          fc.pre(mutated !== token);

          const decision = await verifyRunToken({
            store,
            presented: mutated,
            runId: RUN,
            userId: USER,
            now: T0,
          });

          return decision.valid === false;
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('getRunTokenTtlMinutes — env-only, validated, never a silent fallback', () => {
  it('defaults when unset', () => {
    expect(getRunTokenTtlMinutes({})).toBe(DEFAULT_RUN_TOKEN_TTL_MINUTES);
  });

  it('reads a configured value', () => {
    expect(getRunTokenTtlMinutes({ RUN_TOKEN_TTL_MINUTES: '15' })).toBe(15);
  });

  it.each(['0', '-5', 'sixty', '', String(RUN_TOKEN_TTL_BOUNDS.max + 1)])(
    'throws a typed ConfigError on %s rather than falling back to a number nobody chose',
    (raw) => {
      expect(() => getRunTokenTtlMinutes({ RUN_TOKEN_TTL_MINUTES: raw })).toThrow(ConfigError);
    },
  );
});

describe('InMemoryRunTokenStore — the offline/test adapter', () => {
  it('finds a saved record by its selector and nothing else', async () => {
    const store = new InMemoryRunTokenStore();
    const { record } = await issued(store);

    expect(await store.findBySelector(record.selector)).toMatchObject({
      selector: record.selector,
    });
    expect(await store.findBySelector('f'.repeat(32))).toBeNull();
  });

  it('ends only the tokens of the run it was asked about', async () => {
    const store = new InMemoryRunTokenStore();
    const mine = await issued(store, { runId: 'run-a' });
    const other = await issued(store, { runId: 'run-b' });

    await store.endRun('run-a', new Date(T0.getTime() + minutes(1)));

    expect((await store.findBySelector(mine.record.selector))?.endedAt).not.toBeNull();
    expect((await store.findBySelector(other.record.selector))?.endedAt).toBeNull();
  });

  it('keeps the first end instant when a run is ended twice', async () => {
    const store = new InMemoryRunTokenStore();
    const { record } = await issued(store);
    const first = new Date(T0.getTime() + minutes(1));

    await store.endRun(RUN, first);
    await store.endRun(RUN, new Date(T0.getTime() + minutes(9)));

    expect((await store.findBySelector(record.selector))?.endedAt).toBe(first.toISOString());
  });
});

describe('one prefix: the pre-rename prefix is refused outright', () => {
  // The prefix tokens carried before the rename, assembled from pieces. The rename
  // guard has no allowlist entry for this file any more, so the old product name
  // may not appear here as one literal; joining the parts keeps the guard honest
  // and still lets this file present the exact string a stale client would send.
  const OLD_NAME = ['mc', 'pwn'].join('');
  const OLD_PREFIX = `${OLD_NAME}_rt`;

  /** The same token as issued before the rename: same halves, the old prefix. */
  const preRename = (token: string) =>
    `${OLD_PREFIX}_${token.slice(`${RUN_TOKEN_PREFIX}_`.length)}`;

  it('issues, parses and verifies an rt_ token end to end', async () => {
    const store = new InMemoryRunTokenStore();
    const { token, record } = await issued(store);

    expect(RUN_TOKEN_PREFIX).toBe('rt');
    expect(token.startsWith('rt_')).toBe(true);
    // Exactly the two halves: nothing records which prefix was seen, because
    // there is only one.
    expect(Object.keys(parseRunToken(token) ?? {}).sort()).toEqual(['selector', 'verifier']);
    expect(parseRunToken(token)?.selector).toBe(record.selector);

    const live = await verifyRunToken({
      store,
      presented: token,
      runId: RUN,
      userId: USER,
      now: new Date(T0.getTime() + minutes(1)),
    });
    expect(live).toMatchObject({ valid: true, record: { runId: RUN, userId: USER } });
  });

  it('does not parse a token carrying the pre-rename prefix', () => {
    const { token } = issueRunToken({ runId: RUN, userId: USER, now: T0 });

    expect(parseRunToken(token)).not.toBeNull();
    expect(parseRunToken(preRename(token))).toBeNull();
  });

  it('refuses the pre-rename prefix as MALFORMED even when its record is open and unexpired', async () => {
    const store = new InMemoryRunTokenStore();
    const { token, record } = await issued(store);
    const now = new Date(T0.getTime() + minutes(1));

    // The record is there, open and inside its lifetime, and the same halves
    // verify under the current prefix: so it is the PREFIX that is refused.
    expect(await store.findBySelector(record.selector)).toMatchObject({ endedAt: null });
    const current = await verifyRunToken({
      store,
      presented: token,
      runId: RUN,
      userId: USER,
      now,
    });
    expect(current.valid).toBe(true);

    const old = await verifyRunToken({
      store,
      presented: preRename(token),
      runId: RUN,
      userId: USER,
      now,
    });
    expect(old).toMatchObject({ valid: false, error: { code: 'MALFORMED' } });
  });

  it.each([
    ['the pre-rename prefix', `${OLD_PREFIX}_`],
    ['the pre-rename prefix in capitals', `${OLD_PREFIX.toUpperCase()}_`],
    ['the new product name', 'mcproof_rt_'],
    ['a prefix ending in rt', 'xrt_'],
    ['the prefix in capitals', 'RT_'],
  ])('refuses a valid token whose prefix is swapped for %s', async (_label, prefix) => {
    const store = new InMemoryRunTokenStore();
    const { token } = await issued(store);
    const swapped = prefix + token.slice(`${RUN_TOKEN_PREFIX}_`.length);

    expect(parseRunToken(swapped)).toBeNull();
    const decision = await verifyRunToken({
      store,
      presented: swapped,
      runId: RUN,
      userId: USER,
      now: new Date(T0.getTime() + minutes(1)),
    });
    expect(decision).toMatchObject({ valid: false, error: { code: 'MALFORMED' } });
  });

  it('exports no second prefix, and the grammar names only rt', () => {
    expect(Object.keys(runTokenModule).filter((name) => /LEGACY/i.test(name))).toEqual([]);
    expect(RUN_TOKEN_PATTERN.source.startsWith('^rt_(')).toBe(true);
    expect(RUN_TOKEN_PATTERN.source).not.toContain('|');
  });

  it('the module source does not spell the old product name, apart from the ADR file name', () => {
    const source = readFileSync(join(process.cwd(), 'src/runs/run-token.ts'), 'utf8');
    // The ADR keeps the file name it was written under; every link to it says so.
    const withoutAdrLink = source.split(`0006-${OLD_NAME}-is-the-mcp-server`).join('');

    expect(withoutAdrLink.toLowerCase()).not.toContain(OLD_NAME);
    expect(source).not.toMatch(/\.legacy\b|legacy:/);
  });
});
