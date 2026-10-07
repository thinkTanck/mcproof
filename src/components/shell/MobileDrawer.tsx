import { NAV_ITEMS } from './nav-items';
import { NavLink } from './NavLink';

/**
 * Mobile command-deck: the hamburger + a drawer via the native HTML Popover API
 * — zero client JS (native light-dismiss: Esc + click-outside; top-layer focus).
 * Server-rendered, so it adds no hydration cost to the shell. The button is
 * hidden ≥760px, where the persistent rail takes over.
 */
export function MobileDrawer({ pathname }: { pathname: string }) {
  return (
    <>
      <button
        type="button"
        popoverTarget="mobile-deck"
        aria-label="Open command deck"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line text-ink hover:border-line-em hover:text-ink-hi min-[760px]:hidden"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <line x1="2" y1="4" x2="14" y2="4" />
            <line x1="2" y1="8" x2="14" y2="8" />
            <line x1="2" y1="12" x2="14" y2="12" />
          </g>
        </svg>
      </button>
      {/* No `display` utility on the popover itself: the native
          `[popover]:not(:popover-open){display:none}` UA rule must win when it's
          closed. The flex column lives on the inner wrapper. */}
      <div
        id="mobile-deck"
        popover="auto"
        className="fixed bottom-0 left-0 top-(--header-h) m-0 h-auto w-[236px] border-r border-line-em bg-solid p-4 text-ink shadow-[var(--shadow-drawer)]"
      >
        <div className="flex h-full flex-col">
          <div className="px-3 pb-2.5 pt-1.5 font-mono text-[13px] tracking-[0.16em] text-ink-faint">
            COMMAND DECK
          </div>
          <nav aria-label="Command deck (mobile)" className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </nav>
          <div className="flex-1" />
        </div>
      </div>
    </>
  );
}
