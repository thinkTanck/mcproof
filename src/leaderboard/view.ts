/**
 * PRESENTER — module 5's robustness aggregate rendered as the leaderboard
 * screen's view model, and the home of that view model's types.
 *
 * The aggregator (`buildLeaderboard`) is keyed by model and category and omits
 * cells it has no runs for; the screen is a positional table that needs one
 * cell per column, plus display titles for the category codes. This module is
 * the only place those two shapes meet, so the aggregator stays pure and the
 * screen stays dumb.
 *
 * THREE RULES it exists to enforce:
 *
 *  1. Every displayed value is COMPUTED here from the aggregate, never typed
 *     alongside it.
 *  2. A missing cell is NOT a zero. Zero robustness means "compromised in every
 *     run", which is a claim absent data cannot support, so a hole in the matrix
 *     becomes an explicit NO DATA cell (`state: 'none'`, `robustness: null`).
 *     The union below makes that a type-level guarantee: there is no shape in
 *     which a no-data cell carries a number.
 *  3. Every cell and row is STAMPED with where its number came from. The screen
 *     renders measured cells and fixture cells side by side over time, and a
 *     renderer that had to guess would eventually guess wrong. Provenance is
 *     stated by the caller, never inferred from the data, because whether a run
 *     was real is knowledge the caller has and this function does not.
 */
import type { Category } from '@/contract';
import type { Leaderboard as RobustnessBoard } from './index';

/** Display title per category code. A code with no title renders as the code. */
export type CategoryTitles = Readonly<Partial<Record<Category, string>>>;

/**
 * Where a board's numbers came from.
 *
 * `measured` — real persisted runs of a real model, judged by the locked judge.
 * `fixture`  — placeholder runs that demonstrate the aggregation and the colour
 *              language. Never a result, and labelled as such everywhere it is
 *              rendered.
 */
export type BoardProvenance = 'measured' | 'fixture';

/** Provenance as a CELL can carry it, including the third state: no runs at all. */
export type CellState = BoardProvenance | 'none';

/**
 * One rendered cell. A cell either has runs behind it (and then a number and a
 * provenance) or it has none (and then `null`, which no renderer can format as
 * `0.00` by accident).
 */
export type LeaderboardCell =
  | {
      model: string;
      category: string;
      state: BoardProvenance;
      robustness: number;
      runs: number;
    }
  | {
      model: string;
      category: string;
      state: 'none';
      robustness: null;
      runs: 0;
    };

export type LeaderboardRow = {
  model: string;
  cells: LeaderboardCell[];
  /**
   * Run-weighted across every run of this model, from the aggregator's own
   * total. Null when the model has no valid run left to score (every one was
   * excluded), which the screen draws as No data, never as 0.
   */
  overall: number | null;
  runs: number;
  state: BoardProvenance;
};

export type Leaderboard = {
  categories: { id: string; full: string }[];
  rows: LeaderboardRow[];
  source: BoardProvenance;
  /** Total runs behind the whole board. Zero on an empty measured board. */
  runs: number;
};

export interface LeaderboardViewOptions {
  titles: CategoryTitles;
  /**
   * The category axis to render, in column order. Stated by the caller so an
   * empty or partial board still shows what has NOT been measured.
   */
  categories: readonly Category[];
  /**
   * Provenance, stated by the CALLER. The presenter never assumes it: whether a
   * board came from placeholder runs or measured ones is knowledge the caller
   * has and this function does not.
   */
  source: BoardProvenance;
  /**
   * Models to show as rows even with no scored run behind them, after the
   * aggregate's own. Their every cell, and their OVERALL, is No data. Used for
   * an agent whose runs were all excluded from scoring: the row says it was
   * run, and the No data says none of it counts.
   */
  keepModels?: readonly string[];
}

export function toLeaderboardView(
  board: RobustnessBoard,
  options: LeaderboardViewOptions,
): Leaderboard {
  const axis = options.categories;

  // A category the aggregate counted but the axis does not render would stay
  // inside OVERALL with no cell accounting for it, so the board would not add
  // up. That is a wiring mistake, not a data condition: fail loudly.
  for (const category of board.categories) {
    if (!axis.includes(category)) {
      throw new Error(
        `leaderboard aggregate holds runs for ${category}, which the requested axis does not render`,
      );
    }
  }

  const categories = axis.map((id) => ({ id: id as string, full: options.titles[id] ?? id }));

  // Built from byModel ENTRIES so the model key and its total travel together
  // (no re-lookup, no dead undefined branch) and the aggregator's sorted order
  // is preserved.
  const rows: LeaderboardRow[] = Object.entries(board.byModel).map(([model, total]) => ({
    model,
    cells: axis.map((category): LeaderboardCell => {
      const cell = board.cells[model]?.[category];
      if (!cell) return { model, category, state: 'none', robustness: null, runs: 0 };
      return {
        model,
        category,
        state: options.source,
        robustness: cell.robustness,
        runs: cell.runs,
      };
    }),
    overall: total.robustness,
    runs: total.runs,
    state: options.source,
  }));

  for (const model of options.keepModels ?? []) {
    if (model in board.byModel) continue;
    rows.push({
      model,
      cells: axis.map((category) => ({
        model,
        category,
        state: 'none',
        robustness: null,
        runs: 0,
      })),
      overall: null,
      runs: 0,
      state: options.source,
    });
  }

  return { categories, rows, source: options.source, runs: board.overall.runs };
}
