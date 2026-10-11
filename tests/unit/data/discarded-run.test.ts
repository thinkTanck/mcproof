/**
 * HOW A DISCARDED RUN IS STORED: its own shape, in the same table.
 *
 * A discarded run has no verdict, so it cannot be a `RunResult` and is never
 * dressed up as one. It is a second, strict shape in the same `run` column:
 * the row still exists, so the lifetime allowance still counts it, and every
 * read that means "a judged result" leaves it out.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { RunResultSchema, type RunResult } from '@/contract';
import {
  DiscardedRunSchema,
  InMemoryRunRepository,
  type DiscardedRun,
} from '@/data/run-repository';
import { SupabaseRunRepository } from '@/data/run-repository.supabase';
import { getDataSource } from '@/data/source';
import { checkGlobalSpendCap, createRunTableSpendMeter } from '@/runs/spend-cap';

const DISCARDED: DiscardedRun = {
  discarded: true,
  runId: 'hosted-run-1',
  category: 'ASI05',
  model: 'manual-client',
  steps: 3,
  toolCalls: 1,
  discardedAt: '2026-10-09T10:00:00.000Z',
};

async function judgedRun(): Promise<RunResult> {
  const run = await getDataSource().getRun('sample');
  if (!run) throw new Error('sample run missing');
  return run;
}

describe('DiscardedRunSchema: a discarded run is not a result', () => {
  it('accepts the marker shape', () => {
    expect(DiscardedRunSchema.parse(DISCARDED)).toEqual(DISCARDED);
  });

  it('refuses a verdict, a trace or any other field riding along', () => {
    for (const extra of [
      { verdict: { compromised: false } },
      { compromised: false },
      { trace: { steps: [] } },
      { rationale: 'none' },
    ]) {
      expect(DiscardedRunSchema.safeParse({ ...DISCARDED, ...extra }).success).toBe(false);
    }
  });

  it('refuses a row that does not say it is discarded', () => {
    expect(DiscardedRunSchema.safeParse({ ...DISCARDED, discarded: false }).success).toBe(false);
    const unmarked: Record<string, unknown> = { ...DISCARDED };
    delete unmarked.discarded;
    expect(DiscardedRunSchema.safeParse(unmarked).success).toBe(false);
  });

  it('cannot be read as a RunResult, and a RunResult cannot be read as discarded', async () => {
    expect(RunResultSchema.safeParse(DISCARDED).success).toBe(false);
    expect(DiscardedRunSchema.safeParse(await judgedRun()).success).toBe(false);
  });
});

describe('InMemoryRunRepository: discarded rows', () => {
  it('saves a discarded run under a fresh row id, owned by the user', async () => {
    const repo = new InMemoryRunRepository();
    const stored = await repo.saveDiscardedRun('u1', DISCARDED);

    expect(stored.id).toMatch(/[0-9a-f-]{36}/);
    expect(stored.userId).toBe('u1');
    expect(stored.discarded).toEqual(DISCARDED);
    expect(await repo.getDiscardedRun('u1', stored.id)).toEqual(stored);
    expect(await repo.findDiscardedByRunId('u1', DISCARDED.runId)).toEqual(stored);
  });

  it('keeps discarded rows out of every judged read', async () => {
    const repo = new InMemoryRunRepository();
    const judged = await repo.saveRun('u1', await judgedRun());
    const discarded = await repo.saveDiscardedRun('u1', DISCARDED);

    expect((await repo.listRuns('u1')).map((r) => r.id)).toEqual([judged.id]);
    expect(await repo.getRun('u1', discarded.id)).toBeNull();
    expect(await repo.findByRunId('u1', DISCARDED.runId)).toBeNull();
    expect((await repo.listDiscardedRuns('u1')).map((r) => r.id)).toEqual([discarded.id]);
    expect(await repo.getDiscardedRun('u1', judged.id)).toBeNull();
  });

  it('counts discarded rows in the per-account count the allowance reads', async () => {
    const repo = new InMemoryRunRepository();
    await repo.saveRun('u1', await judgedRun());
    await repo.saveDiscardedRun('u1', DISCARDED);

    expect(await repo.countRunsSince('u1', new Date(0))).toBe(2);
  });

  it('shows another account nothing', async () => {
    const repo = new InMemoryRunRepository();
    const stored = await repo.saveDiscardedRun('u1', DISCARDED);

    expect(await repo.getDiscardedRun('u2', stored.id)).toBeNull();
    expect(await repo.findDiscardedByRunId('u2', DISCARDED.runId)).toBeNull();
    expect(await repo.listDiscardedRuns('u2')).toEqual([]);
    expect(await repo.countRunsSince('u2', new Date(0))).toBe(0);
  });
});

type Result = { single?: unknown; maybeSingle?: unknown; list?: unknown; error?: string };

/** The same minimal chainable fake the adapter's own tests use. */
function fake(result: Result) {
  const calls = { table: '', insert: undefined as unknown, filters: [] as [string, unknown][] };
  const err = result.error ? { message: result.error } : null;
  const builder = {
    insert(v: unknown) {
      calls.insert = v;
      return builder;
    },
    select: () => builder,
    eq(k: string, v: unknown) {
      calls.filters.push([k, v]);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    single: async () => ({ data: result.single, error: err }),
    maybeSingle: async () => ({ data: result.maybeSingle ?? null, error: err }),
    then: (res: (v: unknown) => void) => res({ data: result.list, error: err }),
  };
  const client = { from: (t: string) => ((calls.table = t), builder) } as unknown as SupabaseClient;
  return { client, calls };
}

const row = (id: string, run: unknown) => ({
  id,
  user_id: 'u',
  created_at: '2026-10-09T10:00:00Z',
  run,
});

describe('SupabaseRunRepository: discarded rows', () => {
  it('inserts the marker into the same table and column, with no verdict', async () => {
    const { client, calls } = fake({ single: row('row-d', DISCARDED) });
    const stored = await new SupabaseRunRepository(client).saveDiscardedRun('u', DISCARDED);

    expect(calls.table).toBe('runs');
    expect(calls.insert).toEqual({ user_id: 'u', run: DISCARDED });
    expect(JSON.stringify(calls.insert)).not.toContain('verdict');
    expect(stored).toEqual({
      id: 'row-d',
      userId: 'u',
      createdAt: '2026-10-09T10:00:00Z',
      discarded: DISCARDED,
    });
  });

  it('refuses to insert a marker that carries anything else', async () => {
    const { client, calls } = fake({ single: row('row-d', DISCARDED) });
    const smuggled = { ...DISCARDED, verdict: { compromised: false } } as unknown as DiscardedRun;

    await expect(
      new SupabaseRunRepository(client).saveDiscardedRun('u', smuggled),
    ).rejects.toThrow();
    expect(calls.insert).toBeUndefined();
  });

  it('answers null from getRun for a discarded row, instead of failing to parse it', async () => {
    const { client } = fake({ maybeSingle: row('row-d', DISCARDED) });
    expect(await new SupabaseRunRepository(client).getRun('u', 'row-d')).toBeNull();
  });

  it('answers the marker from getDiscardedRun, scoped by id and owner', async () => {
    const { client, calls } = fake({ maybeSingle: row('row-d', DISCARDED) });
    const stored = await new SupabaseRunRepository(client).getDiscardedRun('u', 'row-d');

    expect(stored?.discarded).toEqual(DISCARDED);
    expect(calls.filters).toEqual([
      ['id', 'row-d'],
      ['user_id', 'u'],
    ]);
  });

  it('answers null from getDiscardedRun for a judged row and for no row', async () => {
    const judged = fake({ maybeSingle: row('row-j', await judgedRun()) });
    const none = fake({});

    expect(await new SupabaseRunRepository(judged.client).getDiscardedRun('u', 'row-j')).toBeNull();
    expect(await new SupabaseRunRepository(none.client).getDiscardedRun('u', 'row-x')).toBeNull();
  });

  it('splits one hosted run id the same way', async () => {
    const discarded = fake({ maybeSingle: row('row-d', DISCARDED) });
    const repo = new SupabaseRunRepository(discarded.client);

    expect(await repo.findByRunId('u', DISCARDED.runId)).toBeNull();
    expect((await repo.findDiscardedByRunId('u', DISCARDED.runId))?.id).toBe('row-d');
    expect(discarded.calls.filters).toContainEqual(['run->>runId', DISCARDED.runId]);
    expect(discarded.calls.filters).toContainEqual(['user_id', 'u']);
  });

  it('lists judged and discarded rows apart, from one mixed table', async () => {
    const judged = await judgedRun();
    const list = [row('row-d', DISCARDED), row('row-j', judged)];

    const runs = await new SupabaseRunRepository(fake({ list }).client).listRuns('u');
    const gone = await new SupabaseRunRepository(fake({ list }).client).listDiscardedRuns('u');

    expect(runs.map((r) => r.id)).toEqual(['row-j']);
    expect(gone.map((r) => r.id)).toEqual(['row-d']);
  });

  it('throws on a query error rather than answering "not discarded"', async () => {
    const { client } = fake({ error: 'boom' });
    await expect(new SupabaseRunRepository(client).getDiscardedRun('u', 'row-d')).rejects.toThrow(
      /getDiscardedRun failed/,
    );
  });
});

/**
 * The spend meter counts JUDGE CALLS by proxy. A discarded run made none, so it
 * is taken out of the total. Both reads fail closed.
 */
describe('createRunTableSpendMeter: a discarded run is not model spend', () => {
  type Count = { count: number | null; error: { message: string } | null };

  function meterClient(total: Count, discarded: Count) {
    const seen: { filters: [string, string][][] } = { filters: [] };
    const client = {
      from() {
        return {
          select(_columns: string, options: unknown) {
            const filters: [string, string][] = [];
            seen.filters.push(filters);
            expect(options).toMatchObject({ count: 'exact', head: true });
            const query = {
              gte(column: string, value: string) {
                filters.push([`gte:${column}`, value]);
                return query;
              },
              eq(column: string, value: string) {
                filters.push([column, value]);
                return query;
              },
              then(resolve: (v: Count) => void) {
                resolve(filters.some(([c]) => c === 'run->>discarded') ? discarded : total);
              },
            };
            return query;
          },
        };
      },
    };
    return { client: client as unknown as SupabaseClient, seen };
  }

  const ok = (count: number | null): Count => ({ count, error: null });
  const since = new Date('2026-10-01T00:00:00.000Z');

  it('subtracts the discarded rows in the period from the total', async () => {
    const { client, seen } = meterClient(ok(17), ok(5));

    expect(await createRunTableSpendMeter(client).countRunsSince(since)).toBe(12);
    expect(seen.filters).toContainEqual([['gte:created_at', since.toISOString()]]);
    expect(seen.filters.find((f) => f.some(([c]) => c === 'run->>discarded'))).toEqual(
      expect.arrayContaining([
        ['run->>discarded', 'true'],
        ['gte:created_at', since.toISOString()],
      ]),
    );
  });

  it('counts everything when nothing was discarded', async () => {
    const { client } = meterClient(ok(17), ok(0));
    expect(await createRunTableSpendMeter(client).countRunsSince(since)).toBe(17);
  });

  it('never goes below zero if a discard lands between the two reads', async () => {
    const { client } = meterClient(ok(2), ok(3));
    expect(await createRunTableSpendMeter(client).countRunsSince(since)).toBe(0);
  });

  it('throws when the discarded count is unknown or errors, so the cap refuses', async () => {
    const unknown = meterClient(ok(17), ok(null));
    const failed = meterClient(ok(17), { count: null, error: { message: 'denied' } });

    await expect(createRunTableSpendMeter(unknown.client).countRunsSince(since)).rejects.toThrow();
    await expect(createRunTableSpendMeter(failed.client).countRunsSince(since)).rejects.toThrow();
    const decision = await checkGlobalSpendCap({
      meter: createRunTableSpendMeter(unknown.client),
      env: { LIVE_RUN_SPEND_CAP: '100' },
      now: since,
    });
    expect(decision.allowed).toBe(false);
  });

  it('lets a period of discards alone leave the whole budget', async () => {
    const { client } = meterClient(ok(5), ok(5));
    const decision = await checkGlobalSpendCap({
      meter: createRunTableSpendMeter(client),
      env: { LIVE_RUN_SPEND_CAP: '5' },
      now: since,
    });

    expect(decision).toMatchObject({ allowed: true, used: 0, remaining: 5 });
  });
});
