'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { isActive, type NavItem } from './nav-items';

/**
 * A single command-deck link with the active glow-bar + aria-current. The active
 * state follows the LIVE route via `usePathname` — the deck lives in a layout,
 * which Next does not re-render on soft (client) navigation, so a header-passed
 * pathname would freeze on the first-loaded route (the deck stuck highlighting
 * Home). `usePathname` re-renders on every navigation. The `pathname` prop is the
 * SSR seed / fallback for when no router is mounted (unit tests), so the server
 * render and hydration still match.
 */
export function NavLink({
  item,
  pathname,
  rail = false,
}: {
  item: NavItem;
  pathname: string;
  /**
   * Drawn in the persistent rail (760px and up) rather than the drawer. Below
   * 1100px the rail is narrow: the full label goes and the short word stacks
   * under the icon instead. From 1100px the link is exactly the drawer's row.
   */
  rail?: boolean;
}) {
  const livePathname = usePathname();
  const active = isActive(livePathname ?? pathname, item);
  // The action routes fold a plain-words purpose into the name, so a newcomer
  // learns what a route does on hover/focus without clicking. Self-explanatory
  // routes keep the bare label.
  const name = item.descriptor ? `${item.label}. ${item.descriptor}` : item.label;
  return (
    <Link
      href={item.href}
      // Unbuilt routes stay visible in the deck but must not be prefetched, or
      // Next would RSC-404 them on load. Fan-out PRs flip `available` per route.
      prefetch={item.available ? undefined : false}
      aria-current={active ? 'page' : undefined}
      // The name, with its purpose, at every width. The icon is aria-hidden and the
      // narrow rail shows only a short word, so the name cannot come from the
      // content. The short word is a piece of this name (WCAG 2.5.3) and is
      // aria-hidden, so a screen reader hears the name once. title keeps the
      // purpose on hover for a mouse.
      aria-label={name}
      title={name}
      className={cn(
        'relative flex items-center gap-3 rounded-md px-3.5 py-3.5 font-mono text-xs tracking-[0.06em] transition-colors',
        // Narrow rail only (760 to 1099px; the rail is not drawn below 760): the
        // word stacks under the icon, and the target is at least 44px.
        rail &&
          'max-[1099px]:min-h-11 max-[1099px]:flex-col max-[1099px]:justify-center max-[1099px]:gap-1 max-[1099px]:px-0.5 max-[1099px]:py-2',
        active ? 'bg-nominal/8 text-nominal' : 'text-ink-hi hover:bg-raised/70',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute bottom-2 left-[-12px] top-2 w-0.5 rounded-full',
          active ? 'bg-nominal shadow-glow-nominal' : 'bg-transparent',
        )}
      />
      <span className="shrink-0 opacity-90">{item.icon}</span>
      <span className={rail ? 'hidden min-[1100px]:inline' : undefined}>{item.label}</span>
      {rail && (
        <span
          data-rail-label
          aria-hidden="true"
          className="instrument one-line whitespace-nowrap text-current min-[1100px]:hidden"
        >
          {item.short}
        </span>
      )}
    </Link>
  );
}
