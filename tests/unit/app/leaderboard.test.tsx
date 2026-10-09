import { render, screen, within } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { RunResultSchema, type Category, type RunResult } from '@/contract';
import type { StoredRun } from '@/data/run-repository';
import { InMemoryRunRepository } from '@/data/run-repository';
import { MEASURED_CLASSIFICATION, MEASURED_COMPROMISE } from '@/eval/measured';
import { buildLeaderboard } from '@/leaderboard';

/**
 * The leaderboard SCREEN. The assertions here are about PROVENANCE, not
 * decoration, because the way this screen fails is not by looking wrong. It is
 * by looking right: a full, plausible grid that implies a model campaign nobody
 * ran.
 *
 * So the screen is held to three things:
 *   1. The measured board reports only runs that exist, and reports NONE when
 *      none exist, in words.
 *   2. The fixture board is unmistakably a fixture, at the section, the board
 *      and the cell.
 *   3. No figure measured about the DETECTOR ever appears here as if it were a
 *      model's robustness.
 */

const mocks = vi.hoisted(() => ({
  user: null as User | null,
  stored: [] as StoredRun[],
}));

vi.mock('@/lib/auth/user', () => ({
  getUser: () => Promise.resolve(mocks.user),
}));

vi.mock('@/data/run-repository.factory', () => ({
  getRunRepository: () =>
    Promise.resolve({
      saveRun: () => Promise.reject(new Error('not used')),
      getRun: () => Promise.resolve(null),
      listRuns: () => Promise.resolve(mocks.stored),
      countRunsSince: () => Promise.resolve(mocks.stored.length),
    }),
}));

const { default: LeaderboardPage } = await import('@/app/(hud)/leaderboard/page');

async function renderPage() {
  return render(await LeaderboardPage());
}

let seq = 0;
function liveRun(model: string, category: Category, compromised: boolean): RunResult {
  seq += 1;
  const runId = `live-${seq}`;
  const target = 'https://mcproof.dev/api/mcp';
  const steps = [{ id: 's1', type: 'principal_instruction', content: 'brief' }];
  return RunResultSchema.parse({
    runId,
    target,
    model,
    category,
    trace: { runId, target, model, category, steps },
    verdict: compromised
      ? {
          runId,
          compromised: true,
          score: 1,
          severity: 'High',
          category,
          rationale: 'compromised',
          stepId: 's1',
        }
      : { runId, compromised: false, score: 0, severity: 'None', category, rationale: 'resisted' },
  });
}

async function store(...runs: RunResult[]): Promise<StoredRun[]> {
  const repo = new InMemoryRunRepository();
  for (const run of runs) await repo.saveRun('user-1', run);
  return repo.listRuns('user-1');
}

beforeEach(() => {
  mocks.user = null;
  mocks.stored = [];
});

describe('Robustness leaderboard screen', () => {
  it('states the robustness definition on screen, in prose a human reads', async () => {
    await renderPage();
    const intro = screen.getByText(/Robustness is the share/i);
    expect(intro.tagName).toBe('P');
    expect(intro).toHaveTextContent(/ended not compromised/i);
    expect(intro).toHaveTextContent(/higher is safer/i);
    // The definition wears a READING role, never an INSTRUMENT one.
    expect(intro.className).toMatch(/\breading\b/);
    expect(intro.className).not.toMatch(/instrument|micro-label|readout/);
  });

  describe('with no measured runs (the state this ships in)', () => {
    it('says plainly that no model has been measured, rather than filling the board', async () => {
      await renderPage();
      expect(screen.getByRole('heading', { name: /measured runs/i })).toBeInTheDocument();
      expect(screen.getByText(/No model has been measured/i)).toBeInTheDocument();
      // No measured grid exists at all: an empty board is not drawn as a grid of
      // blanks pretending to be a report.
      expect(screen.queryByRole('region', { name: /measured .*heatmap/i })).not.toBeInTheDocument();
    });

    it('invites a signed-out visitor to sign in rather than implying runs are hidden', async () => {
      await renderPage();
      expect(screen.getByText(/Sign in to see your own measured runs/i)).toBeInTheDocument();
    });

    it('reads as intentional: it fills from real runs, none published yet, not broken', async () => {
      await renderPage();
      // The empty state must not read as unfinished. One honest sentence says the
      // board fills from real robustness runs and none exist yet, so empty is by
      // design. No invented numbers stand in for the absent runs.
      expect(screen.getByText(/populates from real robustness runs/i)).toBeInTheDocument();
      expect(screen.getByText(/empty by design|none have been published yet/i)).toBeInTheDocument();
    });
  });

  describe('with measured runs', () => {
    beforeEach(async () => {
      mocks.user = { id: 'user-1' } as User;
      // 1 of 2 resisted on ASI06, 1 of 1 on ASI01; every other pair untouched.
      mocks.stored = await store(
        liveRun('agent-under-test', 'ASI06', false),
        liveRun('agent-under-test', 'ASI06', true),
        liveRun('agent-under-test', 'ASI01', false),
      );
    });

    it('shows exactly the values the real aggregator computed from those runs', async () => {
      const board = buildLeaderboard(mocks.stored.map((r) => r.run));
      await renderPage();
      const region = screen.getByRole('region', { name: /measured .*heatmap/i });
      expect(
        within(region).getByText(
          new RegExp(`ASI06.*${board.cells['agent-under-test']?.ASI06?.robustness.toFixed(2)}`),
        ),
      ).toBeInTheDocument();
      // and the sample size travels with it
      expect(within(region).getByText('n=2')).toBeInTheDocument();
    });

    it('leaves the untouched Core-7 pairs as NO DATA rather than scoring them zero', async () => {
      const { container } = await renderPage();
      // Core-7 minus the two categories that were run.
      expect(container.querySelectorAll('[data-cell-state="none"]')).toHaveLength(5);
      const region = screen.getByRole('region', { name: /measured .*heatmap/i });
      expect(within(region).getAllByText(/no data/i).length).toBeGreaterThanOrEqual(5);
      // The five blanks are blanks, not a score of zero.
      expect(within(region).queryByText('0.00')).not.toBeInTheDocument();
    });
  });

  it('displays no fabricated fixture demonstration board (invented models/runs are gone)', async () => {
    await renderPage();
    // The placeholder Model A/B/C campaign was invented numbers, the same problem
    // the removed Fleet Status widget had. The board and every trace of it are gone;
    // only the measured board (empty until real runs exist) remains.
    expect(
      screen.queryByRole('heading', { name: /fixture demonstration/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Fixture · not a measurement/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/never executed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Model A|Model B|Model C/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /fixture .*heatmap/i })).not.toBeInTheDocument();
  });

  it('never reprints a DETECTOR measurement as if it were model robustness', async () => {
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    // Checked at full precision: a two-decimal rounding of a detector figure can
    // legitimately coincide with a computed robustness ratio, and rejecting that
    // would be a test about arithmetic rather than about provenance.
    for (const n of [
      MEASURED_COMPROMISE.precision.toFixed(4),
      MEASURED_CLASSIFICATION.accuracy.toFixed(4),
    ]) {
      expect(text).not.toContain(n);
    }
    // The words appear exactly once, in the sentence that DISCLAIMS them: the
    // screen names the temptation and refuses it rather than staying silent.
    expect(screen.getByText(/published precision and recall describe the judge/i)).toBeVisible();
  });
});
