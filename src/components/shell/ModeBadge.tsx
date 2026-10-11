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
        // The negative right margin below 420px is the header's wrap tolerance
        // (StatusBar): the header's padding and 8px. The `header-end` after it
        // gives the same room back, so it moves nothing.
        'ml-auto -mr-3 inline-flex items-center gap-1 rounded-full border px-1.5 py-1.5 min-[360px]:-mr-5 min-[360px]:gap-1.5 min-[360px]:px-2.5 min-[420px]:mx-0 min-[420px]:gap-2 min-[420px]:px-3',
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
