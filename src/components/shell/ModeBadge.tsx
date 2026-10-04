import { cn } from '@/lib/utils';

export type Mode = 'sample' | 'live';

/** Run-mode indicator in the status bar. The label names the mode (SAMPLE / LIVE) — never color-only. */
export function ModeBadge({ mode = 'sample' }: { mode?: Mode }) {
  const live = mode === 'live';
  return (
    <span
      className={cn(
        // Below 420px the header has no spacer, so the chip pushes itself right,
        // and its padding tightens a little. The word itself never shortens.
        'ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 min-[420px]:ml-0 min-[420px]:gap-2 min-[420px]:px-3',
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
