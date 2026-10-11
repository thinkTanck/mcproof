'use client';

import { cn } from '@/lib/utils';

/**
 * Replay transport: RESET, step back/forward, play/pause, discrete speed buttons
 * (0.5× / 1× / 2× / 4×), a scrub slider, and the STEP n / total readout. The
 * readout reflects the playhead POSITION as it moves — that is position, not an
 * animated fact, so it may update live. Identifiers (run id, severity, offending
 * step) are static elsewhere and never tick.
 */
function ctrlClass(disabled?: boolean): string {
  return cn(
    'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border border-line px-2.5 font-mono text-[14px] tracking-[0.06em] text-ink transition-colors',
    disabled
      ? 'cursor-not-allowed opacity-40'
      : 'hover:border-line-em hover:bg-nominal/[0.06] hover:text-ink-hi',
  );
}

export function Transport({
  current,
  total,
  playing,
  speed,
  speeds,
  onPlayToggle,
  onStep,
  onScrub,
  onRestart,
  onSpeedSet,
  placement,
  className,
}: {
  current: number;
  total: number;
  playing: boolean;
  speed: number;
  speeds: number[];
  onPlayToggle: () => void;
  onStep: (delta: number) => void;
  onScrub: (index: number) => void;
  onRestart: () => void;
  onSpeedSet: (value: number) => void;
  /**
   * Which of the replay's two placements this is (Part D): under the terminal on
   * a phone, under both terminals from 768px up. The server sends both and CSS
   * shows one; see Replay.
   */
  placement?: 'phone' | 'wide';
  /** Classes that show this placement only where it belongs. */
  className?: string;
}) {
  const atStart = current <= 0;
  const atEnd = current >= total - 1;
  return (
    <div
      data-transport-placement={placement}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2.5',
        className,
      )}
    >
      {/* Always enabled: RESET returns to step 0 AND re-arms the export prompt,
          so it stays actionable even when the playhead is already at the start. */}
      <button type="button" onClick={onRestart} className={ctrlClass()} aria-label="Restart">
        <svg width="20" height="20" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M6 2a4 4 0 1 1-3.8 2.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <path d="M2 1.5V4h2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        RESET
      </button>

      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={atStart}
        className={ctrlClass(atStart)}
        aria-label="Previous step"
      >
        {/* Skip-back: bar on the left, triangle pointing left. */}
        <svg width="20" height="20" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4 2v8M4 6l5-4v8z" fill="currentColor" />
        </svg>
      </button>

      <button
        type="button"
        onClick={onPlayToggle}
        className={cn(
          ctrlClass(),
          'border-nominal bg-nominal/10 px-4 text-readout shadow-glow-nominal',
        )}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg width="20" height="20" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2.5" y="2" width="2.5" height="8" fill="currentColor" />
            <rect x="7" y="2" width="2.5" height="8" fill="currentColor" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 12 12" aria-hidden="true">
            <polygon points="3,2 10,6 3,10" fill="currentColor" />
          </svg>
        )}
        {/* On a phone the label keeps one width, PLAY or PAUSE, so the row
            never rewraps when playback ends by itself and nothing shifts. */}
        <span className="phone:inline-block phone:min-w-[6ch] phone:text-left">
          {playing ? 'PAUSE' : 'PLAY'}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={atEnd}
        className={ctrlClass(atEnd)}
        aria-label="Next step"
      >
        {/* Skip-forward: bar on the right, triangle pointing right. */}
        <svg width="20" height="20" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M8 2v8M8 6L3 2v8z" fill="currentColor" />
        </svg>
      </button>

      <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-line sm:block" />

      {/* Speed buttons */}
      <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
        {speeds.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeedSet(s)}
            aria-pressed={speed === s}
            className={cn(
              'inline-flex h-11 min-w-11 items-center justify-center rounded-md border px-2 font-mono text-[14px] transition-colors',
              speed === s
                ? 'border-line-em bg-nominal/[0.08] text-readout'
                : 'border-line text-ink-muted hover:border-line-em hover:text-ink-hi',
            )}
          >
            {s}&times;
          </button>
        ))}
      </div>

      {/* The scrub control's TARGET was 6px tall: the visible track was the whole
          hit area, so the drag handle was a hairline to hit with a mouse and
          barely there with a thumb (WCAG 2.2 target size, 2.5.8). The track still
          reads as a 6px hairline; the control itself is now 24px tall and the
          handle is drawn explicitly, so what you aim at is what you can hit. */}
      <label className="flex min-w-[120px] flex-1 items-center gap-2">
        <span className="sr-only">Scrub to step</span>
        <input
          type="range"
          min={0}
          max={total - 1}
          step={1}
          value={current}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label="Scrub to step"
          aria-valuetext={`Step ${current + 1} of ${total}`}
          className="h-6 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[color:var(--status-nominal)] [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-line [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-line [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[color:var(--status-nominal)]"
        />
      </label>

      <span className="font-mono text-[15px] tabular-nums text-readout" aria-live="off">
        STEP {String(current + 1).padStart(2, '0')}
        <span className="text-ink-faint"> / {String(total).padStart(2, '0')}</span>
      </span>
    </div>
  );
}
