import Link from 'next/link';

/**
 * Labelled empty state for an id that resolves to no run: an unknown id, an
 * unfinished run, or a run belonging to another account. It names the id
 * (recognition over recall) and offers the sample as the way forward.
 *
 * It deliberately replaces a silent fallback to the sample run. Showing someone
 * the ASI06 demonstration under an id they typed is presenting a constructed
 * demonstration as their own result, which is the one thing this product may
 * never do.
 */
export function ReplayEmpty({ id }: { id: string }) {
  return (
    <section aria-label="Replay" className="mx-auto max-w-[720px] px-6 py-16">
      <p className="micro-label text-ink-faint">Replay</p>
      <h1 className="reading-h2 mt-3">No run to replay.</h1>
      <p className="reading measure mt-3 text-ink-muted">
        There is no run for <span className="readout text-readout">{id}</span>. It may still be
        running, it may belong to another account, or the address may be wrong.
      </p>
      <Link
        href="/runs/sample"
        className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md border border-nominal bg-nominal/10 px-5 py-2.5 font-mono text-[14px] tracking-[0.06em] text-ink glow-accent transition-colors hover:bg-nominal/20"
      >
        Play the sample run
      </Link>
    </section>
  );
}
