import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HomeCtas } from '@/components/home/HomeCtas';
import { isE2eFixturesEnabled } from '@/config/e2e-fixtures';
import { describeLiveRunAllowanceNote } from '@/runs/allowance';
import { ConnectStatesFixture } from '../connect-states/fixture';

/**
 * BROWSER-TEST FIXTURE: the free-runs note, with a count handed in.
 *
 * The note beside "Connect your agent" is drawn only when `LIVE_RUN_ALLOWANCE`
 * is set to a whole number above zero. The build CI tests has it unset, so on
 * the real pages a browser can only ever see the note absent. This draws the
 * SAME blocks the real pages draw (Home's calls to action, the Connect screen)
 * and reads the count from the query instead of the environment, through the
 * same `describeLiveRunAllowanceNote()`, so the shown state, the singular, a
 * large value and every hidden value can be measured:
 *
 *   ?where=home&allowance=3              Home's calls to action
 *   ?where=connect&allowance=3           Connect, signed out
 *   ?where=connect&allowance=3&signedIn=1  Connect, signed in
 *
 * A missing `allowance` is the unset case. Nothing here reads or changes the
 * real setting.
 *
 * The same two layers keep it out of production as every fixture: the
 * `.e2e.tsx` extension, which Next only builds with E2E_FIXTURES=1 (and
 * `next.config.ts` refuses that flag on a production deploy), and the check
 * below at request time.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Free-runs note fixture · MCProof',
  robots: { index: false, follow: false },
};

export default async function FreeRunsNoteFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ where?: string; allowance?: string; signedIn?: string }>;
}) {
  if (!isE2eFixturesEnabled(process.env)) notFound();
  const { where, allowance, signedIn } = await searchParams;
  const note = describeLiveRunAllowanceNote({
    LIVE_RUN_ALLOWANCE: typeof allowance === 'string' ? allowance : undefined,
  });

  if (where === 'connect') {
    return <ConnectStatesFixture state="waiting" signedIn={signedIn === '1'} freeRunsNote={note} />;
  }
  return (
    <div className="type-flow mx-auto max-w-[1400px] px-6 py-8">
      <h1 className="reading-h2 mb-4">Free-runs note fixture.</h1>
      <HomeCtas category="ASI02" freeRunsNote={note} />
    </div>
  );
}
