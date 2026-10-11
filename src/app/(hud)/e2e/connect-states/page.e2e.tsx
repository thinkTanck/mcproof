import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CategoryGoals } from '@/components/connect/ConnectScreen';
import { isE2eFixturesEnabled } from '@/config/e2e-fixtures';
import { CategorySchema } from '@/contract';
import { buildHostedSurface } from '@/harness/server/surfaces';
import { RunDiscarded } from '@/components/replay';
import { ConnectStatesFixture } from './fixture';

/**
 * BROWSER-TEST FIXTURE: the Connect screen over fake data.
 *
 * Two layers keep it out of production. First, the `.e2e.tsx` extension: Next
 * only builds this file as a page when E2E_FIXTURES=1 is set for the build, and
 * `next.config.ts` refuses that flag on a production deploy. Second, this check
 * at request time, in case a fixture build is ever started without the flag.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Connect states fixture · MCProof',
  robots: { index: false, follow: false },
};

export default async function ConnectStatesFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (!isE2eFixturesEnabled(process.env)) notFound();
  const { state = 'waiting' } = await searchParams;
  // THE DISCARDED STATE OF THE TWO RUN PAGES. A real one needs a signed-in owner
  // and a stored row, which a browser test in CI has neither of, so these two
  // states draw the same component `/runs/[id]` and `/findings/[id]` draw for
  // it, over invented values, so it can be measured and scanned.
  if (state === 'run-discarded' || state === 'report-discarded') {
    return (
      <RunDiscarded
        surface={state === 'run-discarded' ? 'replay' : 'report'}
        category="ASI01"
        discardedAt="2026-10-09T10:00:00.000Z"
      />
    );
  }
  // The real goals, built the way the Connect route builds them, so the task
  // preview can be measured in a browser with a run issued.
  const categoryGoals: CategoryGoals = Object.fromEntries(
    CategorySchema.options.map((category) => [
      category,
      buildHostedSurface(category, 'malicious').taskGoal,
    ]),
  );
  return <ConnectStatesFixture state={state} categoryGoals={categoryGoals} />;
}
