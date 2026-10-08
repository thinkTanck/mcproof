import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/user';
import { getRunRepository } from '@/data/run-repository.factory';
import { signOut } from '@/lib/auth/actions';
import { SectionLabel } from '@/components/hud';

export const metadata: Metadata = {
  title: 'Your account · MCProof',
  description: 'Your live red-team runs.',
};

/**
 * Account — the signed-in home for a user's own live runs (register: PRODUCT).
 * Gated by `requireUser`: unauthenticated visitors are redirected to sign-in.
 * Runs are read owner-scoped through the RunRepository (RLS at the DB), so this
 * exercises the whole auth → session → RLS path end-to-end. It stays empty until
 * live runs land (Slice 5); the empty state points at Connect.
 */
export default async function AccountPage() {
  const user = await requireUser('/account');
  const runs = await (await getRunRepository()).listRuns(user.id);

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
            className="inline-flex min-h-11 items-center rounded-md border border-line px-4 font-mono text-[13px] uppercase tracking-[0.1em] text-ink-muted transition-colors hover:border-line-em hover:text-ink-hi"
          >
            Sign out
          </button>
        </form>
      </div>

      {runs.length === 0 ? (
        <div className="mt-8 rounded-lg border border-line bg-panel px-6 py-10 text-center">
          <p className="reading measure text-ink-muted">No runs yet.</p>
          <p className="reading measure mt-2 text-ink-faint">
            Point MCProof at your own MCP agent to run your first live red-team.
          </p>
          <Link
            href="/connect"
            className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md border border-nominal bg-nominal/10 px-5 font-mono text-[14px] tracking-[0.06em] text-readout shadow-glow-nominal transition-colors hover:bg-nominal/20"
          >
            Connect your agent →
          </Link>
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-2">
          {runs.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-panel px-4 py-3"
            >
              <span className="flex items-center gap-3 font-mono text-[14px]">
                <span className="text-readout">{r.run.category}</span>
                <span className={r.run.verdict.compromised ? 'text-breach-text' : 'text-nominal'}>
                  {r.run.verdict.compromised ? 'COMPROMISED' : 'CLEAR'}
                </span>
                <span className="text-ink-muted">{r.run.model}</span>
              </span>
              <span className="flex items-center gap-4">
                <time className="font-mono text-[13px] text-ink-faint" dateTime={r.createdAt}>
                  {new Date(r.createdAt).toISOString().slice(0, 10)}
                </time>
                {/* The run is addressed by its ROW id: `RunResult.runId` is
                    `model::category` and is not unique per user over time. */}
                <Link
                  href={`/runs/${r.id}`}
                  className="inline-flex min-h-11 items-center font-mono text-[13px] uppercase tracking-[0.1em] text-nominal underline-offset-4 hover:underline"
                >
                  Replay
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
