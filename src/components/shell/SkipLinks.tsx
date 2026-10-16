'use client';

import type { MouseEvent } from 'react';
import { usePathname } from 'next/navigation';
import { RUN_CONTROLS_ID } from '@/components/connect/run-controls';

/**
 * The routes that draw the Connect screen. The second is the browser-test
 * fixture, which draws the same screen over fake data so a run that is open
 * can be reached in a test; it is only built with E2E_FIXTURES=1
 * (src/config/e2e-fixtures.ts), so in production it names a route that does
 * not exist.
 */
const CONNECT_ROUTES = ['/connect', '/e2e/connect-states'];

/**
 * One look for every skip link: nothing to see until the keyboard is on it,
 * then a solid chip over the top left of the header, at least `--target-min`
 * each way. Only one can be focused at a time, so they share the one place.
 */
const SKIP_LINK =
  'sr-only rounded-md border border-line-em bg-solid px-4 py-2 font-mono text-xs tracking-[0.06em] text-ink focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:target-min focus:inline-flex focus:items-center';

/**
 * Move the keyboard to the run's controls WITHOUT letting the browser scroll
 * to them as a fragment. A fragment jump puts its target at the top of the
 * window, and on a phone the run bar is held at the bottom: the jump scrolled
 * most of the page away to "reach" a bar that was already on screen. `focus()`
 * scrolls only as far as it has to, and honours the page's scroll padding, so
 * the region lands clear of the header and of the bar. Without script the link
 * is still an ordinary fragment link to the same id.
 */
function focusRunControls(event: MouseEvent<HTMLAnchorElement>) {
  const region = document.getElementById(RUN_CONTROLS_ID);
  if (region === null) return;
  event.preventDefault();
  region.focus();
}

/**
 * THE SKIP LINKS (WCAG 2.4.1). The first things the keyboard reaches.
 *
 * "Skip to content" is on every screen and passes the command deck.
 *
 * "Skip to run controls" is on Connect only (UI audit 2026-10-12, batch B). The
 * controls that matter while a run is open (what we have seen, END RUN AND
 * JUDGE, DISCARD RUN) sit past the whole setup in the tab order: on a phone
 * the bar is the last thing in the document. The link goes straight to the
 * element with `RUN_CONTROLS_ID`: the run bar while a run is open, and the
 * block that starts a run while none is (ConnectScreen decides which).
 *
 * A client component because the shell is a layout, which Next does not render
 * again on a navigation inside the app: read from the request alone, the
 * second link would stay on every page after Connect, or never arrive. The
 * `pathname` prop is the server's reading, used until the router answers.
 */
export function SkipLinks({ pathname }: { pathname: string }) {
  const live = usePathname();
  const here = live ?? pathname;
  const onConnect = CONNECT_ROUTES.includes(here);
  return (
    <>
      <a href="#main" className={SKIP_LINK}>
        Skip to content
      </a>
      {onConnect && (
        <a href={`#${RUN_CONTROLS_ID}`} onClick={focusRunControls} className={SKIP_LINK}>
          Skip to run controls
        </a>
      )}
    </>
  );
}
