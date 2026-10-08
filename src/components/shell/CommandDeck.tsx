import { NAV_ITEMS } from './nav-items';
import { NavLink } from './NavLink';
import { AccountEntry } from './AccountEntry';
import type { ShellAccount } from '@/lib/shell-account';

/**
 * Persistent command-deck rail on ≥760px (icon-only 72px → full 236px at
 * ≥1100px). A Server Component — active state comes from `pathname`.
 */
export function CommandDeck({ pathname, account }: { pathname: string; account: ShellAccount }) {
  return (
    <nav
      aria-label="Command deck"
      className="sticky top-(--header-h) hidden h-[calc(100dvh-var(--header-h))] shrink-0 flex-col gap-1 self-start overflow-y-auto border-r border-line bg-gradient-to-b from-[var(--scrim-deck-top)] to-[var(--scrim-deck-bottom)] p-3 min-[760px]:flex min-[760px]:w-[72px] min-[1100px]:w-[236px]"
    >
      <div className="hidden px-3 pb-2.5 pt-1.5 font-mono text-[13px] tracking-[0.16em] text-ink-faint min-[1100px]:block">
        COMMAND DECK
      </div>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          pathname={pathname}
          labelClassName="hidden min-[1100px]:inline"
        />
      ))}
      <div className="flex-1" />
      {/* The way in and the way out, under the destinations. */}
      <AccountEntry
        account={account}
        pathname={pathname}
        labelClassName="hidden min-[1100px]:inline"
      />
    </nav>
  );
}
