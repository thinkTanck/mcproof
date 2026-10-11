import Link from 'next/link';
import { InertMark } from '@/components/leaderboard';
import {
  DISCARD_STILL_COUNTS_SENTENCE,
  RUN_DISCARDED_LABEL,
  RUN_DISCARDED_SENTENCE,
} from '@/runs/discard-copy';

/** Which screen is saying it. The state is the same; only the eyebrow differs. */
const SURFACE_LABEL = {
  replay: 'Live Attack Replay',
  report: 'Findings · Fix report',
} as const;

/**
 * WHAT `/runs/[id]` AND `/findings/[id]` SHOW FOR A RUN ITS OWNER DISCARDED
 * ([ADR-0013](docs/adr/0013-a-discarded-run-is-stored-unjudged.md)).
 *
 * One component for both routes, so the two cannot come to say different things
 * about the same run. It is a real state with a 200, not the not-found page:
 * the run exists and its owner is entitled to know what became of it. Anybody
 * else never reaches this, because the page only renders it for a row the
 * signed-in viewer owns.
 *
 * It states one fact, in READING prose, under an inert badge. Inert and never
 * red or amber: a discarded run was not breached and nothing went wrong with
 * it, it was simply never judged (ADR-0003). The badge is an icon plus a label,
 * never colour alone.
 *
 * There is deliberately no verdict, no step list and no report here, and
 * nothing that looks like one. The category is the class we STAGED, shown as
 * what the run served, never as a classification.
 */
export function RunDiscarded({
  surface,
  category,
  discardedAt,
}: {
  surface: keyof typeof SURFACE_LABEL;
  /** The class the run served. Evidence, printed as stored. */
  category?: string;
  /** ISO-8601 of the discard. Printed as a date, and dropped if unreadable. */
  discardedAt?: string;
}) {
  const at = discardedAt === undefined ? Number.NaN : Date.parse(discardedAt);
  const day = Number.isNaN(at) ? null : new Date(at).toISOString().slice(0, 10);

  return (
    <section aria-labelledby="run-discarded-heading" className="mx-auto max-w-[720px] px-6 py-16">
      <p className="micro-label text-ink-faint">{SURFACE_LABEL[surface]}</p>
      <p
        className="micro-label mt-4 flex items-center gap-2"
        style={{ color: 'var(--status-inert)' }}
      >
        <InertMark />
        {RUN_DISCARDED_LABEL}
      </p>
      <h1 id="run-discarded-heading" className="reading-h2 mt-3">
        {RUN_DISCARDED_SENTENCE}
      </h1>
      <p className="reading measure mt-3 text-ink-muted">
        It was ended before any verdict was asked for, so there is nothing to replay and no report
        to read. {DISCARD_STILL_COUNTS_SENTENCE}
      </p>
      {(category !== undefined || day !== null) && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1">
          {category !== undefined && (
            <p className="instrument-faint">
              SERVED <span className="readout">{category}</span>
            </p>
          )}
          {day !== null && (
            <p className="instrument-faint">
              DISCARDED <span className="readout">{day}</span>
            </p>
          )}
        </div>
      )}
      <Link
        href="/connect"
        className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md border border-nominal bg-nominal/10 px-5 py-2.5 font-mono text-[14px] tracking-[0.06em] text-readout shadow-glow-nominal transition-colors hover:bg-nominal/20"
      >
        Connect your agent
      </Link>
    </section>
  );
}
