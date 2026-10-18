import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LeaderboardHeatmap } from '@/components/leaderboard';
import { isE2eFixturesEnabled } from '@/config/e2e-fixtures';
import { getDataSource } from '@/data/source';
import { measuredLeaderboardFromStored } from '@/leaderboard/measured';

/**
 * BROWSER-TEST FIXTURE: a populated leaderboard.
 *
 * The real `/leaderboard` is built from the signed-in account's own runs, so in
 * CI a browser only ever sees it empty. This draws the SAME heatmap, through
 * the same `measuredLeaderboardFromStored` and its scoring rules, over the seven
 * sample traces relabelled as one agent's runs, so the swipe cue can be measured
 * against a real table at every width (owner ruling 2026-10-18).
 *
 * Kept out of production by the same two layers as every fixture: the
 * `.e2e.tsx` extension, built only with E2E_FIXTURES=1, and the check below.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Leaderboard fixture · MCProof',
  robots: { index: false, follow: false },
};

export default async function LeaderboardFixturePage() {
  if (!isE2eFixturesEnabled(process.env)) notFound();
  const samples = await getDataSource().listRuns();
  const stored = samples.map((run) => ({
    createdAt: '2026-10-16T12:00:00.000Z',
    run: { ...run, model: 'fixture-agent' },
  }));
  const board = measuredLeaderboardFromStored(stored);
  return (
    <section className="type-flow mx-auto max-w-[1600px] px-6 py-10 sm:py-12">
      <h1 className="reading-h2 mb-4">Leaderboard fixture.</h1>
      <LeaderboardHeatmap leaderboard={board} />
    </section>
  );
}
