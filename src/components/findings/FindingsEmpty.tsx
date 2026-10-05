import Link from 'next/link';

/**
 * Labelled empty state for an unknown run id — names the missing id (recognition
 * over recall) and offers a way back, rather than a bare 404. INSTRUMENT label +
 * READING sentence, so the copy stays legible.
 */
export function FindingsEmpty({ id }: { id: string }) {
  return (
    <section
      aria-label="Report not found"
      className="mx-auto flex max-w-[640px] flex-col items-start px-6 py-16"
    >
      <p className="micro-label text-ink-faint">Findings · Fix report</p>
      <h1 className="reading-h2 mt-3">
        No report for run <span className="text-readout">{id}</span>
      </h1>
      <p className="reading measure mt-3">
        This run has no fix report. It may be an unfinished run, or the id may be wrong.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md border border-line-em bg-nominal/5 px-4 py-2 font-mono text-[14px] tracking-[0.08em] text-nominal hover:bg-nominal/10"
      >
        Back to home
      </Link>
    </section>
  );
}
