import { LocalDate } from '@/components/hud/LocalDate';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/user';
import { getDiscardedRunStore } from '@/data/discarded-run-store.factory';
import { getRunRepository } from '@/data/run-repository.factory';
import { signOut } from '@/lib/auth/actions';
import { ConnectCta, SectionLabel } from '@/components/hud';
import { InertMark } from '@/components/leaderboard';
import { asiLabel } from '@/lib/owasp/asi';
import { SCORING_EXCLUSION_LABEL, scoringExclusion } from '@/leaderboard/scoring-rules';

export const metadata: Metadata = {
  title: 'Your account · MCProof',
  description: 'Your live test runs.',
};

/**
 * Account — the signed-in home for a user's own live runs (register: PRODUCT).
 * Gated by `requireUser`: unauthenticated visitors are redirected to sign-in.
 * Runs are read owner-scoped through the RunRepository (RLS at the DB), so this
 * exercises the whole auth → session → RLS path end-to-end. It stays empty until
 * live runs land (Slice 5); the empty state points at Connect.
 *
 * TWO KINDS OF ROW, ONE LIST. A judged run reads as its result and links to its
 * replay. A run its owner discarded
 * ([ADR-0013](docs/adr/0013-a-discarded-run-is-stored-unjudged.md)) reads as
 * DISCARDED, in the inert tone with its icon, and links nowhere: it was never
 * judged, so it has no result to state and no replay to open. It is listed at
 * all because it still counts toward the account's free live runs, and a count
 * the list cannot account for would look like a mistake.
 */
export default async function AccountPage() {
  const user = await requireUser('/account');
  const repository = await getRunRepository();
  const [judged, discarded] = await Promise.all([
    repository.listRuns(user.id),
    (await getDiscardedRunStore()).listDiscardedRuns(user.id),
  ]);
  // One list, newest first, whichever kind each row is.
  const runs = [
    ...judged.map((row) => ({ kind: 'judged' as const, row })),
    ...discarded.map((row) => ({ kind: 'discarded' as const, row })),
  ].sort((a, b) => b.row.createdAt.localeCompare(a.row.createdAt));

  return (
    <section
      aria-labelledby="account-heading"
      className="type-flow mx-auto max-w-[1024px] px-6 py-10 sm:py-12"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionLabel>Account</SectionLabel>
          <h1 id="account-heading" className="reading-h1 mt-3">
            Your runs.
          </h1>
          {/* The signed-in address is a machine value, not a sentence: INSTRUMENT
              (mono readout), never READING. It was written as one — `font-mono
              text-[14px]` — but wore `reading`, and while the role classes were
              unlayered both utilities lost, so it painted 18px sans. */}
          <p className="readout mt-3 text-ink-muted">{user.email}</p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-md border border-line px-4 font-mono text-[13px] uppercase tracking-[0.1em] text-ink transition-colors hover:border-line-em hover:text-ink-hi"
          >
            Sign out
          </button>
        </form>
      </div>

      {runs.length === 0 ? (
        <div className="mt-8 rounded-lg border border-line bg-panel px-6 py-10 text-center">
          <p className="reading measure text-ink-muted">No runs yet.</p>
          <p className="reading measure mt-2 text-ink-faint">
            Connect your own MCP agent to run your first live test.
          </p>
          <div className="mt-5">
            <ConnectCta />
          </div>
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-2">
          {runs.map((entry) => {
            const { row } = entry;
            const item =
              'flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-panel px-4 py-3';
            // The day it ran, labelled, as a person reads it (2026-10-14), in
            // the VIEWER'S time zone (owner ruling 2026-10-15): the server sends
            // the UTC day and the browser draws the reader's own.
            const day = (
              <LocalDate
                iso={row.createdAt}
                prefix="run "
                className="font-mono text-[13px] text-ink-faint"
              />
            );
            if (entry.kind === 'discarded') {
              const run = entry.row.discarded;
              return (
                <li key={row.id} className={item}>
                  <span className="flex items-center gap-3 font-mono text-[14px]">
                    <span className="text-readout">{asiLabel(run.category)}</span>
                    {/* Inert, with its icon: not a result, and never the red a
                        compromise wears or the cyan an all-clear does. */}
                    <span
                      className="inline-flex items-center gap-1.5"
                      style={{ color: 'var(--status-inert)' }}
                    >
                      <InertMark />
                      <span>DISCARDED</span>
                    </span>
                    <span className="text-ink-muted">{run.model}</span>
                  </span>
                  {/* The row keeps the height a linked row has, so the list
                      does not jump between the two kinds. */}
                  <span className="flex min-h-11 items-center gap-4">
                    {day}
                    <span className="font-mono text-[13px] uppercase tracking-[0.1em] text-ink-faint">
                      Not graded
                    </span>
                  </span>
                </li>
              );
            }
            const { run } = entry.row;
            // Why the leaderboard does not score this run, if it does not (owner
            // ruling 2026-10-18). The row is kept; only the count leaves it out.
            const excluded = scoringExclusion(entry.row);
            return (
              // A row with a replay can be pressed anywhere: the link's hit area
              // is stretched over the row (`after:inset-0`), and under a pointer
              // the row's border brightens and "Replay" is underlined.
              // A discarded row has nowhere to go, so it does neither.
              <li
                key={row.id}
                data-run-row="linked"
                className={`${item} group relative transition-colors hover:border-line-em`}
              >
                <span className="flex items-center gap-3 font-mono text-[14px]">
                  <span className="text-readout">{asiLabel(run.category)}</span>
                  <span className={run.verdict.compromised ? 'text-breach-text' : 'text-nominal'}>
                    {run.verdict.compromised ? 'COMPROMISED' : 'NOT COMPROMISED'}
                  </span>
                  <span className="text-ink-muted">{run.model}</span>
                </span>
                <span className="flex items-center gap-4">
                  {day}
                  {/* The run is addressed by its ROW id (`StoredRun.id`), the one
                      id the replay and the report print. `RunResult.runId` is
                      the hosted MCP run's id and is in no URL here. */}
                  <Link
                    href={`/runs/${row.id}`}
                    className="inline-flex min-h-11 items-center font-mono text-[13px] uppercase tracking-[0.1em] text-nominal underline-offset-4 after:absolute after:inset-0 after:rounded-md after:content-[''] group-hover:underline"
                  >
                    Replay
                  </Link>
                </span>
                {excluded ? (
                  <span
                    data-scoring-exclusion={excluded}
                    className="instrument basis-full text-ink-muted"
                  >
                    {SCORING_EXCLUSION_LABEL[excluded]}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
