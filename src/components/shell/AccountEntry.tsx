'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/lib/auth/actions';
import { isSafeNext } from '@/lib/auth/next';
import { cn } from '@/lib/utils';
import type { ShellAccount } from '@/lib/shell-account';

/**
 * THE SHELL'S WAY IN AND WAY OUT. One entry, in one of three states:
 *
 *   signed out  a link to sign in, which comes back to the page you were on
 *   signed in   who is signed in, a link to their runs, and Sign out
 *   preview     auth is not configured on this build: still a link to the
 *               sign-in page, marked PREVIEW so it promises nothing
 *
 * WHERE IT IS DRAWN depends on the width, and it is drawn in exactly one place:
 *
 *   1100px and up   the top right of the header, the last thing on the right
 *                   (`HeaderAccountEntry`, drawn by `StatusBar`)
 *   760 to 1099px   the foot of the narrow rail (`AccountEntry` with `rail`)
 *   under 760px     the foot of the mobile drawer (`AccountEntry`)
 *
 * The header's copy and the rail's are both rendered and switch on the one
 * `header-wide` breakpoint (globals.css), each `display: none` where the other
 * is drawn, so there is never a second Sign in in the tab order or read out.
 * On a phone it stays out of the header: the header has 5px to spare at 320, and
 * the mode chip that says where a run came from must never be pushed off it.
 *
 * A client component for one reason: the shell layout is not re-rendered on a
 * client navigation, so the path it was handed goes stale, and the return path
 * has to be the page the visitor is on NOW (`usePathname`, as `NavLink` does).
 * Sign out is a plain form post of the server action, so it works before any
 * script has loaded.
 *
 * In the narrow rail the words give way to a short word stacked under each icon
 * ("Sign in", "Runs", "Sign out"), each a piece of the control's accessible name
 * and aria-hidden. The names and the tooltips do not depend on either. The rail
 * is only ever the narrow one here: from 1100px the header has the entry.
 */

/** Where the sign-in link points: the sign-in page, and back to `from` after. */
export function signInHref(from: string): string {
  const path = from.replace(/\/+$/, '') || (from.startsWith('/') ? '/' : '');
  // Never back to sign-in itself, and never to anything the sanitiser refuses.
  if (!isSafeNext(from) || path === '/sign-in') return '/sign-in';
  return `/sign-in?next=${encodeURIComponent(from)}`;
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 } as const;

const PersonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
    <circle cx="8" cy="5.5" r="2.6" {...stroke} />
    <path d="M2.8 13.5c.7-2.5 2.7-3.8 5.2-3.8s4.5 1.3 5.2 3.8" {...stroke} strokeLinecap="round" />
  </svg>
);

const SignOutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
    <path d="M6.5 2.5H3.5v11h3" {...stroke} strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M7 8h6.5M11 5.5 13.5 8 11 10.5"
      {...stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const InertIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="shrink-0">
    <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.1" />
    <path d="M3 5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
);

/** The row every control here shares with the destinations above it. */
const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-md px-3.5 py-2.5 font-mono text-xs tracking-[0.06em] text-ink-hi transition-colors hover:bg-raised/70';

/** The narrow rail's version of the row: the word stacks under the icon, 44px or more. */
const RAIL_ROW =
  'max-header-wide:flex-col max-header-wide:justify-center max-header-wide:gap-1 max-header-wide:px-0.5 max-header-wide:py-2';

/**
 * The header's version: as wide as its words, on one line so the header keeps
 * its height, and at least the minimum target each way. Its words wear the
 * INSTRUMENT role, the size every label beside it in the bar is set from, in
 * px like them: the bar is where width is short, and a browser's text-size
 * setting must not swell this one control past its neighbours.
 */
const HEADER_ROW =
  'instrument one-line target-min inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 text-ink-hi transition-colors hover:bg-raised/70';

/** The short word the narrow rail shows; aria-hidden, the name says it already. */
function RailWord({ children }: { children: string }) {
  return (
    <span
      data-rail-label
      aria-hidden="true"
      className="instrument one-line whitespace-nowrap text-current header-wide:hidden"
    >
      {children}
    </span>
  );
}

const PREVIEW_NAME = 'Sign in. Preview: sign-in is not set up on this build.';

/**
 * The neutral fourth state, with an icon and a label: nothing is wrong and
 * nothing was breached, sign-in is simply not set up here.
 */
function PreviewTag({ className }: { className?: string }) {
  return (
    <span
      data-testid="account-preview-tag"
      className={cn(
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-line px-1.5 py-0.5 tracking-[0.12em]',
        className,
      )}
      style={{ color: 'var(--status-inert)' }}
    >
      <InertIcon />
      PREVIEW
    </span>
  );
}

/** Who is signed in: the label, and the address under it. */
function SignedInAs({ email, className }: { email: string; className?: string }) {
  return (
    <div className={className}>
      <span className="block font-mono text-[13px] tracking-[0.16em] text-ink-faint">
        SIGNED IN
      </span>
      <span
        title={email}
        className="mt-1 block max-w-full truncate font-mono text-[13px] text-readout"
      >
        {email}
      </span>
    </div>
  );
}

export function AccountEntry({
  account,
  pathname,
  rail = false,
}: {
  account: ShellAccount;
  /** The path the server rendered the shell for; the router's wins once it has one. */
  pathname: string;
  /**
   * Drawn in the persistent rail, which carries the entry only while it is
   * narrow: a short word replaces the words, and from 1100px the whole entry is
   * gone, because the header draws it there.
   */
  rail?: boolean;
}) {
  const livePathname = usePathname();
  const here = livePathname ?? pathname;
  const row = cn(ROW, rail && RAIL_ROW);
  const frame = cn(
    'flex flex-col gap-1 border-t border-line pt-2',
    // `display: none`, so the copy the header draws is the only one a keyboard
    // or a screen reader meets.
    rail && 'header-wide:hidden',
  );
  const placement = rail ? 'rail' : 'drawer';

  if (account.state === 'signed-in') {
    const runsName = `Your runs, signed in as ${account.email}`;
    return (
      <div data-testid="account-entry" data-account-placement={placement} className={frame}>
        {!rail && <SignedInAs email={account.email} className="px-3.5 pb-1 pt-1.5" />}
        <Link href="/account" aria-label={runsName} title={runsName} className={row}>
          <PersonIcon />
          {rail ? <RailWord>Runs</RailWord> : <span className="whitespace-nowrap">Your runs</span>}
        </Link>
        <form action={signOut}>
          <button type="submit" aria-label="Sign out" title="Sign out" className={row}>
            <SignOutIcon />
            {rail ? (
              <RailWord>Sign out</RailWord>
            ) : (
              <span className="whitespace-nowrap">Sign out</span>
            )}
          </button>
        </form>
      </div>
    );
  }

  const preview = account.state === 'preview';
  const name = preview ? PREVIEW_NAME : 'Sign in';
  return (
    <div data-testid="account-entry" data-account-placement={placement} className={frame}>
      <Link href={signInHref(here)} aria-label={name} title={name} className={row}>
        <PersonIcon />
        {rail ? <RailWord>Sign in</RailWord> : <span className="whitespace-nowrap">Sign in</span>}
        {/* The narrow rail has no room for the tag; the name and the tooltip say it. */}
        {preview && !rail && <PreviewTag className="ml-auto text-xs" />}
      </Link>
    </div>
  );
}

/**
 * THE SAME ENTRY, IN THE HEADER (1100px and up): the last thing on the right.
 *
 * One row instead of a stack. Signed out it is the one link; signed in it is
 * Your runs and Sign out, in the same place, and never a Sign in beside them.
 *
 * `compact` is the replay, whose bar is already full of the run's telemetry:
 * there the address is not written out. It is still in the link's name and its
 * tooltip, and on the account page the link opens.
 *
 * Hidden below the line with `display: none`, where the rail or the drawer
 * draws the entry, so there is one of it at every width.
 */
export function HeaderAccountEntry({
  account,
  pathname,
  compact = false,
}: {
  account: ShellAccount;
  /** The path the server rendered the shell for; the router's wins once it has one. */
  pathname: string;
  /** The bar is full of a run's telemetry: do not write the address out. */
  compact?: boolean;
}) {
  const livePathname = usePathname();
  const here = livePathname ?? pathname;
  // `ml-auto` does nothing while the entry shares the row (the bar takes the
  // free room first). When enlarged text drops it to a row of its own, it keeps
  // it at the right, where it is at every other time.
  const frame = 'ml-auto hidden shrink-0 items-center gap-1 header-wide:flex';

  if (account.state === 'signed-in') {
    const runsName = `Your runs, signed in as ${account.email}`;
    return (
      <div data-testid="account-entry" data-account-placement="header" className={frame}>
        {!compact && <SignedInAs email={account.email} className="max-w-56 px-2 text-right" />}
        <Link href="/account" aria-label={runsName} title={runsName} className={HEADER_ROW}>
          <PersonIcon />
          <span>Your runs</span>
        </Link>
        <form action={signOut} className="flex">
          <button type="submit" aria-label="Sign out" title="Sign out" className={HEADER_ROW}>
            <SignOutIcon />
            <span>Sign out</span>
          </button>
        </form>
      </div>
    );
  }

  const preview = account.state === 'preview';
  const name = preview ? PREVIEW_NAME : 'Sign in';
  return (
    <div data-testid="account-entry" data-account-placement="header" className={frame}>
      <Link href={signInHref(here)} aria-label={name} title={name} className={HEADER_ROW}>
        <PersonIcon />
        <span>Sign in</span>
        {/* The tag takes the size of the label it sits beside. */}
        {preview && <PreviewTag />}
      </Link>
    </div>
  );
}
