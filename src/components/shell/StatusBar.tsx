import type { ReactNode } from 'react';
import Link from 'next/link';
import { LogoLockup } from './LogoRing';
import { ModeBadge, type Mode } from './ModeBadge';
import { MobileDrawer } from './MobileDrawer';
import type { ShellAccount } from '@/lib/shell-account';

/** Run-context telemetry shown in the status bar on a run screen. */
export type RunContext = {
  runId: string;
  model: string;
  category: string;
  severity: string;
  compromised: boolean;
};

/**
 * Top status bar (banner). Server-rendered — the mobile drawer is a native
 * popover, so the shell ships no client JS. Dominant MCPwn lockup + a one-line
 * condensing meta. On a run screen it also carries the RUN · TARGET · DETECTOR
 * context and the outcome + severity (desktop only, so it never wraps).
 */
export function StatusBar({
  pathname,
  mode,
  meta = 'SENTINEL FIELDS',
  runContext,
  account = { state: 'signed-out' },
}: {
  /**
   * Passed straight through to the mobile drawer, which is opened from here.
   * The header itself draws no account control.
   */
  account?: ShellAccount;
  pathname: string;
  /** Where the run on show came from. Absent on a screen that shows no run. */
  mode?: Mode;
  meta?: ReactNode;
  runContext?: RunContext;
}) {
  const sevBreach = runContext ? /^(critical|high)$/i.test(runContext.severity) : false;
  return (
    // PHONE WIDTHS IN THE FALLBACK FONT (#176). Geist loads with display
    // 'optional', so a first visit can keep next/font's wider fallback for the
    // page's lifetime, and in it this row needed 405px. Below 420px the header
    // tightens its spacing instead of dropping anything: 12px padding, 8px gaps,
    // no empty spacer (the chip takes `ml-auto`), and a tighter logo and chip. That
    // fits at 360 with 9px to spare. From 420px up every value is unchanged.
    //
    // 320px (WCAG 1.4.10 Reflow: a 1280px window at 400% zoom). The 360 spacing
    // still needs 351px there, so below 360px there is one tighter tier, again
    // spacing only: 4px padding and 4px gaps. That needs 315px, 5px to spare.
    <header className="sticky top-0 z-[45] flex h-(--header-h) shrink-0 items-center gap-1 border-b border-line bg-gradient-to-b from-[var(--scrim-header-top)] to-[var(--scrim-header-bottom)] px-1 backdrop-blur-[6px] min-[360px]:gap-2 min-[360px]:px-3 min-[420px]:gap-4 min-[420px]:px-[18px]">
      <MobileDrawer pathname={pathname} account={account} />
      <Link
        href="/"
        aria-label="MCPwn home"
        className="flex shrink-0 items-center gap-1 rounded-md min-[360px]:gap-1.5 min-[420px]:gap-2.5"
      >
        <LogoLockup />
      </Link>
      {/* THE BAR: everything between the wordmark and the mode chip, and the
          pulse that crosses it. The bar takes whatever width the row has left
          and is as tall as the header, so its bottom edge IS the header's
          bottom border from the wordmark to the chip. The pulse is a 2.5px line
          laid on that edge (its track hangs 5px below the bar: one pixel so the
          line covers the border, four of padding for the glow), with a slow line of light travelling along it
          left to right (`.header-pulse` in globals.css). CSS only, so the
          shell still ships no client JS.

          It rides the border rather than the blank space on purpose. On a run
          screen at desktop width the telemetry fills the bar and leaves a few
          dozen pixels blank, which is exactly where the mode matters most; the
          edge is always the full run from wordmark to chip.

          The pulse says what the chip says, as colour: brighter nominal over a
          live run, quieter over a sample, a neutral line tone where there is no
          run. Where a chip follows, the track ends at it; where none does, it
          fades out before the right edge. It is decoration, never the only
          signal, so it is hidden from assistive technology.

          It cannot move the layout: the track is absolutely positioned, and only
          transform and opacity are animated. Below 420px the header used to
          have no spacer and the chip pushed itself right; the bar is there at
          every width now, and its negative margin gives back the one extra gap
          that would cost, so the row needs exactly the width it did (#176,
          #178). */}
      <div className="relative -ml-1 flex min-w-0 flex-1 items-center gap-1 self-stretch min-[360px]:-ml-2 min-[360px]:gap-2 min-[420px]:ml-0 min-[420px]:gap-4">
        <div className="hidden h-[26px] w-px shrink-0 bg-line min-[760px]:block" />
        <div className="hidden shrink-0 font-mono text-[13.5px] tracking-[0.1em] text-ink-faint min-[760px]:block">
          {meta}
        </div>

        {runContext && (
          <>
            <div className="hidden h-[26px] w-px shrink-0 bg-line min-[1100px]:block" />
            <div className="hidden min-w-0 truncate font-mono text-[13.5px] tracking-[0.06em] text-ink-muted min-[1100px]:block">
              RUN <span className="text-readout">{runContext.runId}</span>
              <span aria-hidden="true"> · </span>TARGET{' '}
              <span className="text-readout">{runContext.model}</span>
              <span aria-hidden="true"> · </span>DETECTOR{' '}
              <span className="text-nominal">BLIND</span>
            </div>
          </>
        )}

        <div className="flex-1" />

        {runContext && (
          <div className="hidden items-center gap-3 min-[1100px]:flex">
            <span
              className={
                'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[13px] tracking-[0.12em] ' +
                (runContext.compromised
                  ? 'border-breach/40 text-breach-text shadow-glow-breach'
                  : 'border-nominal/40 text-nominal shadow-glow-nominal')
              }
            >
              <span
                aria-hidden="true"
                className={
                  'h-1.5 w-1.5 rotate-45 ' + (runContext.compromised ? 'bg-breach' : 'bg-nominal')
                }
              />
              {runContext.compromised ? 'BREACH' : 'CLEAR'}
            </span>
            <span className="whitespace-nowrap font-mono text-[13.5px] tracking-[0.06em] text-ink-faint">
              {runContext.category} · SEV{' '}
              <span className={sevBreach ? 'text-breach-text' : 'text-caution'}>
                {runContext.severity.toUpperCase()}
              </span>
            </span>
          </div>
        )}

        <div
          aria-hidden="true"
          data-header-pulse={mode ?? 'neutral'}
          data-pulse-ends={mode ? 'chip' : 'edge'}
          className="header-pulse absolute inset-x-0 -bottom-[5px]"
        >
          {/* One glint. It takes 8.4s to cross, then the bar rests for 3.6s. */}
          <span className="header-pulse-glint" />
        </div>
      </div>

      {mode && <ModeBadge mode={mode} />}
    </header>
  );
}
