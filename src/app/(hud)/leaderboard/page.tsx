import type { Metadata } from 'next';
import { ConnectCta, SectionLabel } from '@/components/hud';
import { InertMark, LeaderboardHeatmap } from '@/components/leaderboard';
import { getRunRepository } from '@/data/run-repository.factory';
import { measuredLeaderboardFromStored } from '@/leaderboard/measured';
import { getUser } from '@/lib/auth/user';

export const metadata: Metadata = {
  title: 'Your leaderboard · MCProof',
  description:
    'How often your agent was not compromised, by model and attack type, from your own graded runs.',
};

/**
 * ROBUSTNESS LEADERBOARD (route `/leaderboard`, register: PRODUCT).
 *
 * Server component. ONE board: MEASURED, built by module 5 from the runs this
 * account has actually persisted, read owner-scoped through `RunRepository`.
 * Nobody has produced a multi-model campaign yet (plan.md B4), so what this ships
 * as is an EMPTY board with the reason stated. An empty leaderboard that says why
 * is worth more than a full one implying work nobody did.
 *
 * The placeholder "fixture demonstration" board was REMOVED: even framed and
 * labelled, its Model A/B/C campaign was invented numbers, the same problem the
 * removed Fleet Status widget had, and a fabricated board beside the real
 * provenance discredits it. The aggregation it used to demonstrate is exercised
 * by its own unit tests instead.
 *
 * NO NUMBER ON THIS SCREEN IS INVENTED OR BORROWED. Every value is computed by
 * `buildLeaderboard` from run verdicts. The detector's published precision,
 * recall and classification accuracy are deliberately absent: they measure the
 * JUDGE, not any model's resistance, and reusing them here would manufacture a
 * robustness figure out of an unrelated measurement.
 */
export default async function LeaderboardPage() {
  const user = await getUser();

  // Owner-scoped: a leaderboard is only ever built from runs the caller owns.
  const stored = user ? await (await getRunRepository()).listRuns(user.id) : [];
  // Scored by the written rules (`src/leaderboard/scoring-rules.ts`): manual
  // clients are not on the board, and excluded runs count toward nothing.
  const measured = measuredLeaderboardFromStored(stored);

  return (
    <section
      aria-labelledby="leaderboard-heading"
      className="type-flow mx-auto max-w-[1600px] px-6 py-10 sm:py-12"
    >
      <SectionLabel>Your leaderboard</SectionLabel>
      <h1 id="leaderboard-heading" className="reading-h1 mt-3">
        Agent model by attack type.
      </h1>
      <p className="reading mt-4 measure">
        Each cell shows the share of your runs for that model and attack type where the agent was
        not compromised, as graded by the detector. Higher is safer: 1.00 means the agent was never
        compromised. OVERALL counts every run in the row, so a cell with more runs weighs more. A
        cell with no runs says No data, because 0 would mean compromised every time.
      </p>

      <h2 className="reading-h2 mt-10">Measured runs</h2>
      {measured.rows.length === 0 ? (
        <div className="mt-4 rounded-lg border border-line bg-panel px-6 py-8">
          <p
            className="micro-label flex items-center gap-2"
            style={{ color: 'var(--status-inert)' }}
          >
            <InertMark />
            No measurement yet
          </p>
          <p className="reading mt-3 measure">
            This board shows the results of your own live runs. You have no graded runs yet, so it
            is empty. We never fill it with other numbers. The detector accuracy on the home page
            measures the detector, not how well any agent resists attacks.
          </p>
          <p className="reading measure mt-3 text-ink-muted">
            {user
              ? 'A row appears for each agent model once its runs are graded.'
              : 'Sign in to see your own measured runs here.'}
          </p>
          <div className="mt-5">
            <ConnectCta />
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <LeaderboardHeatmap leaderboard={measured} />
        </div>
      )}
    </section>
  );
}
