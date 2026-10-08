import { RunResultSchema, type Category, type RunResult } from '@/contract';
import { CORE7_AXIS } from '@/leaderboard/axis';
import { measuredLeaderboard } from '@/leaderboard/measured';

/**
 * THE MEASURED BOARD — per-model robustness computed from the runs a user has
 * actually persisted. This is the half of the leaderboard that is allowed to
 * claim anything, so what it must get right is what it does with an absence:
 *
 *  - No runs at all: an EMPTY board. Not a demonstration, not an extrapolation,
 *    not the detector's precision/recall borrowed under a different name.
 *  - Some runs: only the cells those runs cover carry a number; the rest are
 *    NO DATA.
 *
 * plan.md B4 is open precisely because nobody has produced these runs yet, so
 * the zero-run case is the one this ships in.
 */

let seq = 0;

function run(model: string, category: Category, compromised: boolean): RunResult {
  seq += 1;
  const runId = `measured-run-${seq}`;
  const target = 'https://mcproof.dev/api/mcp';
  const steps = [{ id: 's1', type: 'principal_instruction', content: 'brief' }];
  const verdict = compromised
    ? {
        runId,
        compromised: true,
        score: 1,
        severity: 'High',
        category,
        rationale: 'compromised',
        stepId: 's1',
      }
    : { runId, compromised: false, score: 0, severity: 'None', category, rationale: 'resisted' };
  return RunResultSchema.parse({
    runId,
    target,
    model,
    category,
    trace: { runId, target, model, category, steps },
    verdict,
  });
}

describe('measuredLeaderboard — the board built from persisted live runs', () => {
  it('is EMPTY for zero runs, and says measured rather than pretending otherwise', () => {
    const board = measuredLeaderboard([]);
    expect(board.rows).toEqual([]);
    expect(board.runs).toBe(0);
    expect(board.source).toBe('measured');
    // The Core-7 axis survives an empty board so the screen can state what is
    // not yet measured without naming a single model.
    expect(board.categories.map((c) => c.id)).toEqual([...CORE7_AXIS]);
    for (const c of board.categories) expect(c.full).not.toBe(c.id);
  });

  it('computes a cell only where runs exist and leaves the rest NO DATA', () => {
    const board = measuredLeaderboard([
      run('claude-x', 'ASI06', false),
      run('claude-x', 'ASI06', true),
      run('claude-x', 'ASI01', false),
    ]);

    expect(board.rows).toHaveLength(1);
    const row = board.rows[0];
    expect(row?.model).toBe('claude-x');
    expect(row?.runs).toBe(3);
    expect(row?.overall).toBeCloseTo(2 / 3, 10);
    expect(row?.cells).toHaveLength(CORE7_AXIS.length);

    const byCategory = Object.fromEntries((row?.cells ?? []).map((c) => [c.category, c]));
    expect(byCategory.ASI06).toMatchObject({ state: 'measured', robustness: 0.5, runs: 2 });
    expect(byCategory.ASI01).toMatchObject({ state: 'measured', robustness: 1, runs: 1 });
    for (const id of ['ASI02', 'ASI03', 'ASI04', 'ASI05', 'ASI10']) {
      expect(byCategory[id]).toMatchObject({ state: 'none', robustness: null, runs: 0 });
    }
    expect(board.runs).toBe(3);
  });

  it('keeps models apart and reports one row per model that has runs', () => {
    const board = measuredLeaderboard([
      run('model-a', 'ASI02', false),
      run('model-b', 'ASI02', true),
      run('model-b', 'ASI02', true),
    ]);
    expect(board.rows.map((r) => r.model)).toEqual(['model-a', 'model-b']);
    expect(board.rows[0]?.overall).toBe(1);
    expect(board.rows[1]?.overall).toBe(0);
  });

  it('never carries a held-out label: a RunResult has none and the board adds none', () => {
    const board = measuredLeaderboard([run('model-a', 'ASI02', true)]);
    expect(JSON.stringify(board)).not.toMatch(/groundTruth/);
  });
});
