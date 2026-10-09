import { issueRunToken, verifyRunToken, type RunTokenRecord } from '@/runs/run-token';
import { SupabaseRunTokenStore } from '@/runs/run-token.supabase';
import { FakeDatabase } from '../../helpers/fake-supabase';

const ISSUED = new Date('2026-08-05T10:00:00.000Z');

function issued(): { token: string; record: RunTokenRecord } {
  return issueRunToken({ runId: 'run-1', userId: 'user-1', now: ISSUED, ttlMs: 60 * 60_000 });
}

describe('SupabaseRunTokenStore', () => {
  it('writes the digest and never the token', async () => {
    const db = new FakeDatabase();
    const { token, record } = issued();

    await new SupabaseRunTokenStore(db.client()).save(record);

    const [row] = db.rows('run_tokens');
    expect(row).toEqual({
      selector: record.selector,
      verifier_hash: record.verifierHash,
      algorithm: 'sha256',
      run_id: 'run-1',
      user_id: 'user-1',
      issued_at: record.issuedAt,
      expires_at: record.expiresAt,
      ended_at: null,
    });
    // The one assertion this table exists for.
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(token.split('_').at(-1));
  });

  it('round-trips a record a real verification then accepts', async () => {
    const db = new FakeDatabase();
    const store = new SupabaseRunTokenStore(db.client());
    const { token, record } = issued();
    await store.save(record);

    const decision = await verifyRunToken({
      store,
      presented: token,
      runId: 'run-1',
      userId: 'user-1',
      now: new Date('2026-08-05T10:30:00.000Z'),
    });

    expect(decision.valid).toBe(true);
  });

  it('answers null for a selector it does not hold', async () => {
    const db = new FakeDatabase();
    expect(await new SupabaseRunTokenStore(db.client()).findBySelector('nope')).toBeNull();
  });

  it('ends every OPEN token of one run, and leaves other runs alone', async () => {
    const db = new FakeDatabase();
    const store = new SupabaseRunTokenStore(db.client());
    const mine = issued();
    const theirs = issueRunToken({
      runId: 'run-2',
      userId: 'user-1',
      now: ISSUED,
      ttlMs: 60 * 60_000,
    });
    await store.save(mine.record);
    await store.save(theirs.record);

    const endedAt = new Date('2026-08-05T10:20:00.000Z');
    await store.endRun('run-1', endedAt);

    expect((await store.findBySelector(mine.record.selector))?.endedAt).toBe(endedAt.toISOString());
    expect((await store.findBySelector(theirs.record.selector))?.endedAt).toBeNull();
  });

  it('refuses a token whose run ended, on the stored stamp', async () => {
    const db = new FakeDatabase();
    const store = new SupabaseRunTokenStore(db.client());
    const { token, record } = issued();
    await store.save(record);
    await store.endRun('run-1', new Date('2026-08-05T10:10:00.000Z'));

    const decision = await verifyRunToken({
      store,
      presented: token,
      runId: 'run-1',
      userId: 'user-1',
      now: new Date('2026-08-05T10:11:00.000Z'),
    });

    expect(decision.valid).toBe(false);
    if (decision.valid) return;
    expect(decision.error.code).toBe('RUN_ENDED');
  });

  it('refuses a token past its wall clock, on the stored expiry', async () => {
    const db = new FakeDatabase();
    const store = new SupabaseRunTokenStore(db.client());
    const { token, record } = issued();
    await store.save(record);

    const decision = await verifyRunToken({
      store,
      presented: token,
      runId: 'run-1',
      userId: 'user-1',
      now: new Date('2026-08-05T11:00:01.000Z'),
    });

    expect(decision.valid).toBe(false);
    if (decision.valid) return;
    expect(decision.error.code).toBe('EXPIRED');
  });

  it('sweeps rows no verification could ever accept', async () => {
    const db = new FakeDatabase();
    const store = new SupabaseRunTokenStore(db.client());
    await store.save(issued().record);
    await store.save(
      issueRunToken({
        runId: 'run-2',
        userId: 'user-1',
        now: ISSUED,
        ttlMs: 24 * 60 * 60_000,
      }).record,
    );

    const swept = await store.sweepExpired(new Date('2026-08-05T12:00:00.000Z'));

    expect(swept).toBe(1);
    expect(db.rows('run_tokens')).toHaveLength(1);
  });

  it('throws rather than answering null when the store itself fails', async () => {
    const db = new FakeDatabase();
    db.failWith = 'permission denied';
    const store = new SupabaseRunTokenStore(db.client());

    await expect(store.findBySelector('x')).rejects.toThrow(/permission denied/);
    await expect(store.save(issued().record)).rejects.toThrow(/permission denied/);
    await expect(store.endRun('run-1', ISSUED)).rejects.toThrow(/permission denied/);
  });

  it('rejects a stored row that is not a token record, instead of trusting it', async () => {
    const db = new FakeDatabase();
    db.rows('run_tokens').push({
      selector: 'abc',
      verifier_hash: 'deadbeef',
      algorithm: 'md5',
      run_id: 'run-1',
      user_id: 'user-1',
      issued_at: ISSUED.toISOString(),
      expires_at: ISSUED.toISOString(),
      ended_at: null,
    });

    await expect(new SupabaseRunTokenStore(db.client()).findBySelector('abc')).rejects.toThrow();
  });
});
