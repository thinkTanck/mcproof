import Link from 'next/link';
import { ConnectCta } from '@/components/hud';
import { FreeRunsNote } from '@/components/hud/FreeRunsNote';
import { asiLabel } from '@/lib/owasp/asi';

/**
 * HOME'S TWO CALLS TO ACTION, and the lines that belong to them.
 *
 * "Play sample" is the one filled button on the page; "Connect your agent" is
 * the second step, outlined, the same control every other page draws
 * (ConnectCta). Under them: the name of the featured run, which the filled
 * button has no room for, and between them the free-runs note.
 *
 * THE FREE-RUNS NOTE sits here, in the block that holds the Connect button, so
 * it is read as a note on that action. The caller reads it on the server
 * (`describeLiveRunAllowanceNote()`), and passes nothing when no count is
 * configured, in which case nothing is drawn and the block is as it was.
 *
 * Its own component so the browser-test fixture can draw the same block with a
 * value handed in: the build CI tests has no count configured.
 */
export function HomeCtas({
  category,
  freeRunsNote,
}: {
  /** The featured category code, e.g. "ASI02". */
  category: string;
  /** The free-runs sentence, or nothing when no count is configured. */
  freeRunsNote?: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-5">
        {/* The button has no room for the category's name, so it points
            at the line under it, which spells the name out. */}
        <Link
          href="/runs/sample"
          aria-describedby="featured-run-name"
          className="inline-flex items-center gap-2 rounded-md border border-nominal bg-nominal/10 px-6 py-3 font-mono text-[14px] tracking-[0.08em] text-ink glow-accent transition-colors hover:bg-nominal/20"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <polygon points="2,1 11,6 2,11" fill="currentColor" />
          </svg>
          Play {category} sample
        </Link>
        {/* The second step, outlined: the filled button beside it is the
            one dominant action on this page. The same control as on
            every other page that offers it (ConnectCta). */}
        <ConnectCta />
      </div>
      {/* Directly under the buttons, before the featured run's name: on a
          phone the two buttons stack, and this is then the line under
          "Connect your agent". */}
      <FreeRunsNote text={freeRunsNote} />
      <p id="featured-run-name" className="instrument-faint">
        Featured sample: {asiLabel(category)}. Pick any of the 7 attack types to watch its sample.
      </p>
    </div>
  );
}
