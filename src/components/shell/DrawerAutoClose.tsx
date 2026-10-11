'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * THE DRAWER CLOSES WHEN YOU GO SOMEWHERE (mobile sweep 2026-10-10, S2).
 *
 * The drawer is a native popover in the shell layout, and Next does not
 * re-render a layout on a client navigation, so nothing ever closed it: a tap on
 * Leaderboard changed the URL and left the menu lying over the new page.
 *
 * This renders nothing. It closes the drawer, through the platform's own
 * `hidePopover()`, in two cases:
 *
 *   a plain tap or click on any link inside it (a destination, the account
 *   entry, or the page you are already on, which is no route change at all);
 *   a pathname change while it is open (Back, Forward, a redirect).
 *
 * Either way focus goes back to the menu button, the control that opened it, so
 * a keyboard or screen-reader user is left where they started rather than on
 * the body. Next's own navigation focus runs in the commit phase, before this
 * component's effect, so the effect has the last word; the header is sticky, so
 * the button is never under it.
 *
 * A click with a modifier or a middle button opens the link elsewhere and the
 * reader stays on this page, so the drawer stays open. Escape and tapping
 * outside are the popover's own light dismiss and are left alone. Where the
 * platform has no Popover API the drawer never opened, so there is nothing to do.
 */

/** Is the drawer showing? False where the platform has no popover support. */
export function isDrawerOpen(drawer: HTMLElement): boolean {
  try {
    return drawer.matches(':popover-open');
  } catch {
    return false;
  }
}

/** Hide an open drawer and focus the button that opened it. True if it closed. */
export function closeDrawer(drawer: HTMLElement, trigger: HTMLElement | null): boolean {
  if (!isDrawerOpen(drawer)) return false;
  drawer.hidePopover();
  trigger?.focus();
  return true;
}

/** A plain primary-button activation of a link inside the drawer. */
export function isLinkActivation(event: MouseEvent, drawer: HTMLElement): boolean {
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const link = target.closest('a[href]');
  return link !== null && drawer.contains(link);
}

export function DrawerAutoClose({ drawerId, triggerId }: { drawerId: string; triggerId: string }) {
  const pathname = usePathname();
  const lastPathname = useRef(pathname);

  useEffect(() => {
    const drawer = document.getElementById(drawerId);
    if (!drawer) return;
    const onClick = (event: MouseEvent) => {
      if (isLinkActivation(event, drawer)) {
        closeDrawer(drawer, document.getElementById(triggerId));
      }
    };
    drawer.addEventListener('click', onClick);
    return () => drawer.removeEventListener('click', onClick);
  }, [drawerId, triggerId]);

  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    const drawer = document.getElementById(drawerId);
    if (drawer) closeDrawer(drawer, document.getElementById(triggerId));
  }, [pathname, drawerId, triggerId]);

  return null;
}
