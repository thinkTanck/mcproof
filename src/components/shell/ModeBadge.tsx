import { cn } from '@/lib/utils';

export type Mode = 'sample' | 'live';

/** Run-mode indicator in the status bar. The label names the mode (SAMPLE / LIVE) — never color-only. */
export function ModeBadge({ mode }: { mode: Mode }) {
  const live = mode === 'live';
  return (
    <span
      className={cn(
        // Below 420px the header has no spacer, so the chip pushes itself right,
        // and its padding tightens a little, and once more below 360px so the
        // header reflows at 320. The word itself never shortens.
        //
        // The negative right margin below 480px is how far the chip may reach
        // into the header's right padding before the row wraps: EXACTLY the
        // padding (4, 12, 18px, the header's own three steps), so it can touch
        // the screen edge and never pass it. It was the padding plus 8px, and
        // those 8px were drawn off the screen (#221). The `header-end` after
        // it (StatusBar) gives the same room back wherever the row has it, so
        // it moves nothing. It has to be on the chip and not on the item after
        // it: a row is filled item by item, and the chip is refused before a
        // later item's margin is counted (WebKit does exactly that).
        'ml-auto -mr-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-1.5 min-[360px]:-mr-3 min-[360px]:gap-1.5 min-[360px]:px-2.5 min-[420px]:ml-0 min-[420px]:-mr-[18px] min-[420px]:gap-2 min-[420px]:px-3 min-[480px]:mr-0',
        live ? 'border-nominal bg-nominal/10 shadow-glow-nominal' : 'border-line-em bg-nominal/5',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-2 w-2 rounded-full',
          live ? 'bg-nominal shadow-glow-nominal' : 'border border-line-em',
        )}
      />
      <span
        className={cn(
          'font-mono text-[14px] font-medium tracking-[0.12em]',
          live ? 'text-readout' : 'text-ink-muted',
        )}
      >
        {live ? 'LIVE' : 'SAMPLE'}
      </span>
    </span>
  );
}
