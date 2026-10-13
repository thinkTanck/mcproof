import type { ReactNode } from 'react';
import Link from 'next/link';
import { LogoLockup } from './LogoRing';
import { ModeBadge, type Mode } from './ModeBadge';
import { MobileDrawer } from './MobileDrawer';
import { HeaderHeightSync } from './HeaderHeightSync';
import { HeaderAccountEntry } from './AccountEntry';
import { cn } from '@/lib/utils';
import type { ShellAccount } from '@/lib/shell-account';
import { RUN_CATEGORY_NAME_ID } from '@/components/hud/AsiLabel';

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
 * popover, whose only script closes it on navigation (DrawerAutoClose). Dominant MCProof lockup + a one-line
 * condensing meta. On a run screen it also carries the RUN · TARGET · DETECTOR
 * context and the outcome + severity (desktop only, so it never wraps). From
 * 1100px (`header-wide`) the way in and out sits at its right end: Sign in, or
 * the account entry, the last thing on the right on every page.
 */
export function StatusBar({
  pathname,
  mode,
  meta = 'SENTINEL FIELDS',
  runContext,
  account = { state: 'signed-out' },
}: {
  /**
   * Who the shell says is signed in. Drawn at the right end of the bar from
   * 1100px, and passed through to the mobile drawer, which is opened from here.
   */
  account?: ShellAccount;
  pathname: string;
  /** Where the run on show came from. Absent on a screen that shows no run. */
  mode?: Mode;
  meta?: ReactNode;
  runContext?: RunContext;
}) {
  const sevBreach = runContext ? /^(critical|high)$/i.test(runContext.severity) : false;
  // THE WAY IN AND OUT, at the right end from 1100px (`header-wide`), the last
  // thing on the right on every page. Below that it is `display: none` and the
  // rail or the drawer draws the entry, so there is one of it at any width.
  //
  // Where it goes in the markup depends on the chip, so that it is last either
  // way. With a chip it follows the chip, and the chip sits to its left. With no
  // chip it is the last thing INSIDE the bar, so the bar still runs to the
  // header's right edge and the pulse along its bottom edge still crosses the
  // whole header, under the entry, as it did.
  //
  // Over a run's telemetry (the replay) the bar is full, so the entry does not
  // write the signed-in address out there; it stays in the link's name.
  const accountEntry = (
    <HeaderAccountEntry account={account} pathname={pathname} compact={Boolean(runContext)} />
  );
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
    //
    // ENLARGED TEXT (WCAG 1.4.4). The header is at least `--header-h`, not
    // exactly it, and its row may wrap, so with the text enlarged the mode chip
    // drops to a second row instead of pushing the page sideways. At normal text
    // size it must not, and in the fallback font the row is wider than the
    // header's content box at every phone width: the chip has always reached
    // into the right padding below 420px, and at 420 to 431px it needs up to
    // 431.5px with the 18px padding on each side.
    //
    // THE ROW NEVER REACHES PAST THE SCREEN (#221). So on a screen with a chip,
    // below 480px, the two side paddings are not fixed room, they are room the
    // row can take back. On the right the chip may reach into the padding by
    // exactly the padding (its negative margin, see ModeBadge), and
    // `header-end` after it is a zero-width item that grows back into whatever
    // the row has left, up to that padding. On the left `header-start` does
    // the same before the menu button (its negative margins cancel the padding
    // and the gap beside it). The left one takes the room first, so a row that
    // fits is drawn exactly as it always was: full left padding, the chip as far
    // into the right padding as it needs. A row that needs more gives up the
    // left padding too, down to nothing. Only a row wider than the whole screen
    // wraps, which at normal text size none is and with enlarged text the
    // chip's is.
    //
    // The chip's margin used to be the padding PLUS 8px, so the row wrapped only
    // once the chip was more than 8px past the screen edge. In WebKit's
    // fallback font at 360px the row is 365.5px, 5.5px too wide, and was drawn
    // off the screen: the page scrolled sideways by 6px. A screen with no chip
    // is untouched.
    <header className="sticky top-0 z-[45] flex min-h-(--header-h) shrink-0 flex-wrap items-center gap-1 border-b border-line bg-gradient-to-b from-[var(--scrim-header-top)] to-[var(--scrim-header-bottom)] px-1 backdrop-blur-[6px] min-[360px]:gap-2 min-[360px]:px-3 min-[420px]:gap-4 min-[420px]:px-[18px]">
      {/* Renders nothing: it reports this header's real height to the page, so
          what is pinned under it clears it when enlarged text makes it taller. */}
      <HeaderHeightSync />
      {/* The left padding, as room the row can take back (see the note above).
          It grows first, so it is the full padding wherever the row fits. */}
      {mode && (
        <span
          aria-hidden="true"
          data-testid="header-start"
          className="-ml-1 -mr-1 max-w-1 shrink-0 grow-[1000000] basis-0 min-[360px]:-ml-3 min-[360px]:-mr-2 min-[360px]:max-w-3 min-[420px]:-ml-[18px] min-[420px]:-mr-4 min-[420px]:max-w-[18px] min-[480px]:hidden"
        />
      )}
      <MobileDrawer pathname={pathname} account={account} />
      <Link
        href="/"
        aria-label="MCProof home"
        className="target-min flex shrink-0 items-center gap-1 rounded-md min-[360px]:gap-1.5 min-[420px]:gap-2.5"
      >
        <LogoLockup />
      </Link>
      {/* THE BAR: everything between the wordmark and the mode chip, and the
          pulse that crosses it. The bar takes whatever width the row has left
          and is as tall as the header, so its bottom edge IS the header's
          bottom border from the wordmark to the chip. The pulse is a 2.5px line
          laid on that edge (its track hangs 5px below the bar: one pixel so the
          line covers the border, four of padding for the glow), with a slow line of light travelling along it
          left to right (`.header-pulse` in globals.css). CSS only: the pulse
          adds no client JS.

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
      <div
        className={cn(
          'relative -ml-1 flex min-w-0 flex-1 items-center gap-1 self-stretch min-[360px]:-ml-2 min-[360px]:gap-2 min-[420px]:ml-0 min-[420px]:gap-4',
          // With no chip the account entry is the last thing inside this bar
          // (see `accountEntry` above). The bar can be narrower than what is
          // in it, so with the text enlarged the entry has to be able to drop
          // to a second row here, the way it does beside a chip, or it would
          // be drawn past the screen (WCAG 1.4.4). At normal text size the row
          // fits and nothing wraps.
          !mode && 'header-wide:flex-wrap',
        )}
      >
        {/* THE TAG. On the replay it steps aside from 1100px, where the run
            telemetry, the outcome, the chip and the account entry all share the
            bar: in the fallback font that left the telemetry no room at all,
            and the tag is the one thing there that says nothing about the run.
            Every other screen keeps it at every width it had it. */}
        <div
          className={cn(
            'hidden h-[26px] w-px shrink-0 bg-line min-[760px]:block',
            runContext && 'header-wide:hidden',
          )}
        />
        <div
          className={cn(
            'hidden shrink-0 font-mono text-[13.5px] tracking-[0.1em] text-ink-faint min-[760px]:block',
            runContext && 'header-wide:hidden',
          )}
        >
          {meta}
        </div>

        {runContext && (
          <>
            <div className="hidden h-[26px] w-px shrink-0 bg-line header-wide:block" />
            <div className="hidden min-w-0 truncate font-mono text-[13.5px] tracking-[0.06em] text-ink-muted header-wide:block">
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
          <div className="hidden items-center gap-3 header-wide:flex">
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
            {/* One line with no room for the category's name, so the code points
                at the place the replay under this bar spells it out (the
                category row of its verdict rail). */}
            <span
              aria-describedby={RUN_CATEGORY_NAME_ID}
              className="whitespace-nowrap font-mono text-[13.5px] tracking-[0.06em] text-ink-faint"
            >
              {runContext.category} · SEV{' '}
              <span className={sevBreach ? 'text-breach-text' : 'text-caution'}>
                {runContext.severity.toUpperCase()}
              </span>
            </span>
          </div>
        )}

        {!mode && accountEntry}

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
      {/* The room the chip gives back below 480px (see the note on the header
          and ModeBadge). Basis 0, and its negative margin gives back the gap
          before it, so it never wraps on its own. It takes free space ahead of
          the bar, after the left side has its padding, up to the padding the
          chip may reach into, so with room to spare the chip ends one padding
          from the edge, as it always did, and with none it ends at the edge. */}
      {mode && (
        <span
          aria-hidden="true"
          data-testid="header-end"
          className="-ml-1 max-w-1 shrink-0 grow-[1000] basis-0 min-[360px]:-ml-2 min-[360px]:max-w-3 min-[420px]:-ml-4 min-[420px]:max-w-[18px] min-[480px]:hidden"
        />
      )}
      {mode && accountEntry}
    </header>
  );
}
