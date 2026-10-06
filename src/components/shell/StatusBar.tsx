import type { ReactNode } from 'react';
import Link from 'next/link';
import { ModeBadge, type Mode } from './ModeBadge';
import { MobileDrawer } from './MobileDrawer';

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
}: {
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
    <header className="sticky top-0 z-[45] flex h-[72px] shrink-0 items-center gap-1 border-b border-line bg-gradient-to-b from-[var(--scrim-header-top)] to-[var(--scrim-header-bottom)] px-1 backdrop-blur-[6px] min-[360px]:gap-2 min-[360px]:px-3 min-[420px]:gap-4 min-[420px]:px-[18px]">
      <MobileDrawer pathname={pathname} />
      <Link
        href="/"
        aria-label="MCPwn home"
        className="flex shrink-0 items-center gap-1 rounded-md min-[360px]:gap-1.5 min-[420px]:gap-2.5"
      >
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="shrink-0 animate-[spin_22s_linear_infinite]"
        >
          <circle cx="12" cy="12" r="9" fill="none" stroke="var(--line-emphasis)" strokeWidth="1" />
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="var(--status-nominal)"
            strokeWidth="1.4"
            strokeDasharray="6 44"
          />
          <circle cx="12" cy="12" r="2.2" fill="var(--status-nominal)" />
        </svg>
        <span className="font-mono text-[21px] font-semibold tracking-[0.09em] text-ink-hi">
          MCP<span className="text-nominal">wn</span>
        </span>
      </Link>
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
            <span aria-hidden="true"> · </span>DETECTOR <span className="text-nominal">BLIND</span>
          </div>
        </>
      )}

      <div className="hidden flex-1 min-[420px]:block" />

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

      {mode && <ModeBadge mode={mode} />}
    </header>
  );
}
