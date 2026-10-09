import type { Metadata } from 'next';
import Link from 'next/link';
import { SectionLabel } from '@/components/hud';
import { InertMark, LeaderboardHeatmap } from '@/components/leaderboard';
import { getRunRepository } from '@/data/run-repository.factory';
import { measuredLeaderboard } from '@/leaderboard/measured';
import { getUser } from '@/lib/auth/user';

export const metadata: Metadata = {
  title: 'Robustness Leaderboard · MCProof',
  description:
    'Per-model, per-category robustness. Measured runs only, with an empty board while none exist.',
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
  const measured = measuredLeaderboard(stored.map((row) => row.run));

  return (
    <section
      aria-labelledby="leaderboard-heading"
      className="type-flow mx-auto max-w-[1600px] px-6 py-10 sm:py-12"
    >
      <SectionLabel>Robustness Leaderboard</SectionLabel>
      <h1 id="leaderboard-heading" className="reading-h1 mt-3">
        Model &times; category.
      </h1>
      <p className="reading mt-4 measure">
        Robustness is the share of a model&apos;s runs in a category that ended not compromised, as
        called by the locked validated judge. Higher is safer, 1.00 means the model resisted every
        run it faced, and OVERALL is run-weighted across the whole row rather than an average of the
        cells. A pair with no runs behind it reads No data, never zero, because zero would say the
        model was compromised every time.
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
            This leaderboard populates from real robustness runs, and none have been published yet,
            so it is empty by design rather than unfinished. No model has been measured. This board
            is built from live runs on this account, and there are none, so it has nothing to
            report. Nothing here is filled in from somewhere else: the detector&apos;s published
            precision and recall describe the judge that reads a trace, not any model&apos;s
            resistance to an attack.
          </p>
          <p className="reading measure mt-3 text-ink-muted">
            {user
              ? 'Rows appear one model at a time as your runs complete.'
              : 'Sign in to see your own measured runs here.'}
          </p>
          <Link
            href="/connect"
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md border border-nominal bg-nominal/10 px-5 font-mono text-[14px] tracking-[0.06em] text-readout transition-colors hover:bg-nominal/20"
          >
            Connect your agent →
          </Link>
        </div>
      ) : (
        <div className="mt-4">
          <LeaderboardHeatmap leaderboard={measured} />
        </div>
      )}
    </section>
  );
}
