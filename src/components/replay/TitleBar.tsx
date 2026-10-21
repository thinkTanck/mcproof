import type { ReactNode } from 'react';

/**
 * A TERMINAL'S TITLE BAR (owner ruling KEY POLISH, 2026-10-20): the strip
 * across the top of a window that names it. The transcript's reads "AGENT
 * SESSION" with the run id at the right; the verdict's reads "DETECTOR".
 *
 * On the panel surface and line tokens, no new colour. `--title-bar-h` tall
 * while it holds one line, which is the height the box under it gives back so
 * Play does not move. It is never cut: a run id too long for the bar (a live
 * run's on a phone, or any id under the WCAG 1.4.12 spacing override) wraps,
 * and the bar grows. INSTRUMENT text, so it keeps the role's 1.5 line height.
 * Static text: no control, no live region. The box under it is drawn as it
 * was, with its top corners squared to meet the bar (`TerminalWindow`).
 */
export function TitleBar({
  id,
  name,
  run,
}: {
  id: 'session' | 'detector';
  name: string;
  run?: string;
}) {
  return (
    <div
      data-title-bar={id}
      className="instrument flex min-h-(--title-bar-h) shrink-0 flex-wrap items-center justify-between gap-x-4 rounded-t-lg border border-b-0 border-line bg-panel px-4 py-1 text-ink-muted"
    >
      <span data-title-bar-name="" className="shrink-0 uppercase tracking-[0.1em]">
        {name}
      </span>
      {run !== undefined ? (
        <span data-title-bar-run="" className="min-w-0 text-readout [overflow-wrap:anywhere]">
          {run}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A title bar and the box it names, as one window. On a phone the transcript's
 * window is a flex item that may shrink, so the box keeps its 45% cap and the
 * terminal and the controls still fit one screen.
 */
export function TerminalWindow({ bar, children }: { bar: ReactNode; children: ReactNode }) {
  return (
    <div
      data-terminal-window=""
      className="flex min-w-0 flex-col phone:min-h-0 [&>[data-elev]]:rounded-t-none"
    >
      {bar}
      {children}
    </div>
  );
}
