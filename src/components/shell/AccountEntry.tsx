'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/lib/auth/actions';
import { isSafeNext } from '@/lib/auth/next';
import { cn } from '@/lib/utils';
import type { ShellAccount } from '@/lib/shell-account';

/**
 * THE SHELL'S WAY IN AND WAY OUT. One entry at the bottom of the command deck
 * (the rail) and of the mobile drawer, in one of three states:
 *
 *   signed out  a link to sign in, which comes back to the page you were on
 *   signed in   who is signed in, a link to their runs, and Sign out
 *   preview     auth is not configured on this build: still a link to the
 *               sign-in page, marked PREVIEW so it promises nothing
 *
 * It is NOT in the header. The header has 5px to spare at 320 and is full on the
 * replay at desktop width, and the mode chip that says where a run came from
 * must never be pushed off it.
 *
 * A client component for one reason: the shell layout is not re-rendered on a
 * client navigation, so the path it was handed goes stale, and the return path
 * has to be the page the visitor is on NOW (`usePathname`, as `NavLink` does).
 * Sign out is a plain form post of the server action, so it works before any
 * script has loaded.
 *
 * In the icon-only rail (760 to 1100px) `labelClassName` hides the words. The
 * accessible names and the tooltips do not depend on them.
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

const PREVIEW_NAME = 'Sign in. Preview: sign-in is not set up on this build.';

export function AccountEntry({
  account,
  pathname,
  labelClassName,
}: {
  account: ShellAccount;
  /** The path the server rendered the shell for; the router's wins once it has one. */
  pathname: string;
  /** Applied to the words, so the icon-only rail can hide them. */
  labelClassName?: string;
}) {
  const livePathname = usePathname();
  const here = livePathname ?? pathname;

  if (account.state === 'signed-in') {
    const runsName = `Your runs, signed in as ${account.email}`;
    return (
      <div data-testid="account-entry" className="flex flex-col gap-1 border-t border-line pt-2">
        <div className={cn('px-3.5 pb-1 pt-1.5', labelClassName)}>
          <span className="block font-mono text-[13px] tracking-[0.16em] text-ink-faint">
            SIGNED IN
          </span>
          <span
            title={account.email}
            className="mt-1 block max-w-full truncate font-mono text-[13px] text-readout"
          >
            {account.email}
          </span>
        </div>
        <Link href="/account" aria-label={runsName} title={runsName} className={ROW}>
          <PersonIcon />
          <span className={cn('whitespace-nowrap', labelClassName)}>Your runs</span>
        </Link>
        <form action={signOut}>
          <button type="submit" aria-label="Sign out" title="Sign out" className={ROW}>
            <SignOutIcon />
            <span className={cn('whitespace-nowrap', labelClassName)}>Sign out</span>
          </button>
        </form>
      </div>
    );
  }

  const preview = account.state === 'preview';
  const name = preview ? PREVIEW_NAME : 'Sign in';
  return (
    <div data-testid="account-entry" className="flex flex-col gap-1 border-t border-line pt-2">
      <Link href={signInHref(here)} aria-label={name} title={name} className={ROW}>
        <PersonIcon />
        <span className={cn('whitespace-nowrap', labelClassName)}>Sign in</span>
        {preview && (
          // The neutral fourth state, with an icon and a label: nothing is wrong
          // and nothing was breached, sign-in is simply not set up here.
          <span
            data-testid="account-preview-tag"
            className={cn(
              'ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-line px-1.5 py-0.5 text-xs tracking-[0.12em]',
              labelClassName,
            )}
            style={{ color: 'var(--status-inert)' }}
          >
            <InertIcon />
            PREVIEW
          </span>
        )}
      </Link>
    </div>
  );
}
