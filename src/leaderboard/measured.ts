import type { RunResult } from '@/contract';
import { buildLeaderboard } from './index';
import { CORE7_AXIS, CORE7_TITLES } from './axis';
import { toLeaderboardView, type Leaderboard } from './view';
import { isAttackRun, isManualClient, scoringExclusion, type ScorableRun } from './scoring-rules';

/**
 * THE MEASURED BOARD — per-model robustness over the runs that were actually
 * executed and persisted (plan.md B4).
 *
 * Pure: the caller does the reading (the runs come from `RunRepository`,
 * owner-scoped), this does the arithmetic. That keeps the honest part testable
 * without a database and keeps auth out of the aggregation.
 *
 * WHAT IT DOES WITH AN ABSENCE IS THE WHOLE POINT. Nobody has produced a
 * multi-model campaign yet, so the case this ships in is `runs = []`, and the
 * answer to that is an EMPTY board: no rows, zero runs, `source: 'measured'`.
 * It is not padded with the fixture, and it is not extrapolated from the
 * detector's measured precision/recall — those figures describe the JUDGE (does
 * it call a compromise correctly, and file the right category), not any model's
 * resistance, and reusing them here would be inventing a measurement.
 *
 * The Core-7 axis is rendered whole even when only one column has runs, so the
 * board reports what has not been measured as plainly as what has.
 */
export function measuredLeaderboard(runs: RunResult[]): Leaderboard {
  return toLeaderboardView(buildLeaderboard(runs), {
    titles: CORE7_TITLES,
    categories: CORE7_AXIS,
    source: 'measured',
  });
}

/**
 * THE MEASURED BOARD OVER STORED ROWS, with the scoring rules applied
 * (owner ruling 2026-10-18; `scoring-rules.ts`). Nothing is removed from the
 * store: a manual client's runs are left off the board, a run excluded from
 * scoring counts toward no cell and no OVERALL, and an agent whose runs were
 * all excluded keeps its row, which reads No data throughout. Only ATTACK runs
 * are scored: a benign control, or a run whose kind was not recorded, counts
 * toward no cell, no n, no OVERALL and so no Weakest banner (LAUNCH POLISH).
 */
export function measuredLeaderboardFromStored(stored: readonly ScorableRun[]): Leaderboard {
  const agents = stored.filter((row) => !isManualClient(row.run.model));
  const scored = agents
    .filter((row) => isAttackRun(row) && scoringExclusion(row) === null)
    .map((row) => row.run);
  const models = [...new Set(agents.map((row) => row.run.model))].sort();
  return toLeaderboardView(buildLeaderboard(scored), {
    titles: CORE7_TITLES,
    categories: CORE7_AXIS,
    source: 'measured',
    keepModels: models,
  });
}
