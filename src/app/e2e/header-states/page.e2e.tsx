import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StatusBar } from '@/components/shell/StatusBar';
import { isE2eFixturesEnabled } from '@/config/e2e-fixtures';

/**
 * BROWSER-TEST FIXTURE: the real status bar over a chosen mode.
 *
 * A LIVE header cannot be reached on a real route in a browser test: it needs a
 * signed-in account and a stored live run. This renders the real `StatusBar`
 * with the mode named in the query (`live`, `sample`, anything else is no run),
 * so its chip and its pulse can be measured at every width.
 *
 * It sits outside the HUD layout on purpose, so this bar is the only one on the
 * page. The same two layers keep it out of production as every fixture: the
 * `.e2e.tsx` extension, which Next only builds with E2E_FIXTURES=1 (and
 * `next.config.ts` refuses that flag on a production deploy), and the check
 * below at request time.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Header states fixture · MCProof',
  robots: { index: false, follow: false },
};

export default async function HeaderStatesFixturePage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (!isE2eFixturesEnabled(process.env)) notFound();
  const { mode } = await searchParams;
  const origin = mode === 'live' || mode === 'sample' ? mode : undefined;
  return (
    <div className="min-h-dvh bg-base font-sans text-ink">
      <StatusBar
        pathname="/runs/fixture-run"
        mode={origin}
        runContext={
          origin && {
            runId: 'fixture-run',
            model: 'fixture-model',
            category: 'ASI02',
            severity: 'High',
            compromised: true,
          }
        }
      />
      <main className="px-6 py-10">
        <p className="reading measure">
          Header states fixture. Everything on this page is invented, and it exists only in a build
          made for browser tests.
        </p>
      </main>
    </div>
  );
}
