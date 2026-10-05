import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { CategoryGoals } from '@/components/connect/ConnectScreen';
import { isE2eFixturesEnabled } from '@/config/e2e-fixtures';
import { CategorySchema } from '@/contract';
import { buildHostedSurface } from '@/harness/server/surfaces';
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
  title: 'Connect states fixture · MCPwn',
  robots: { index: false, follow: false },
};

export default async function ConnectStatesFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (!isE2eFixturesEnabled(process.env)) notFound();
  const { state = 'waiting' } = await searchParams;
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
