import { render, screen, within } from '@testing-library/react';
import { CommandDeck } from '@/components/shell/CommandDeck';
import { MobileDrawer } from '@/components/shell/MobileDrawer';
import { NAV_ITEMS } from '@/components/shell/nav-items';
import type { ShellAccount } from '@/lib/shell-account';

/**
 * THE CURRENT NAV ITEM SAYS SO TWICE (UI audit 2026-10-12, batch B).
 *
 * `aria-current="page"` on exactly one item of each nav, chosen from the
 * pathname (a nested route lights the item of the section it is in), and none
 * on a page the deck has no item for. And a bar beside the current item, so
 * the state is a shape and not colour alone.
 *
 * jsdom lays nothing out: that the bar is at least 2px wide, 3:1 and actually
 * drawn is measured in tests/e2e/buttons-targets-nav-skip.spec.ts.
 */

const SIGNED_OUT: ShellAccount = { state: 'signed-out' };
const INDICATOR = '[data-nav-indicator]';

const CASES: [pathname: string, current: string | null][] = [
  ['/', 'Home'],
  ['/connect', 'Connect / Run'],
  ['/runs/sample', 'Live Replay'],
  ['/runs/3f2b6c1e-8a4d-4c1b-9e57-0a1b2c3d4e5f', 'Live Replay'],
  ['/leaderboard', 'Leaderboard'],
  ['/findings/sample', 'Findings'],
  ['/findings/asi10-goal-drift', 'Findings'],
  ['/threats', 'Threat Model'],
  // No item for these: nothing is current.
  ['/account', null],
  ['/sign-in', null],
  ['/e2e/connect-states', null],
];

const NAVS = [
  {
    name: 'the rail',
    label: 'Command deck',
    draw: (pathname: string) => render(<CommandDeck pathname={pathname} account={SIGNED_OUT} />),
  },
  {
    name: 'the drawer',
    label: 'Command deck (mobile)',
    draw: (pathname: string) => render(<MobileDrawer pathname={pathname} account={SIGNED_OUT} />),
  },
];

describe.each(NAVS)('$name: the current item', ({ label, draw }) => {
  it.each(CASES)('%s marks %s and nothing else', (pathname, current) => {
    draw(pathname);
    // The drawer is a closed popover in jsdom; its links are still in the tree.
    const nav = screen.getByRole('navigation', { name: label, hidden: true });
    const links = within(nav).getAllByRole('link', { hidden: true });
    const marked = links.filter((link) => link.getAttribute('aria-current') !== null);

    if (current === null) {
      expect(marked).toHaveLength(0);
      return;
    }
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveAttribute('aria-current', 'page');
    expect(marked[0]!.getAttribute('aria-label')!.startsWith(current)).toBe(true);
  });

  it('every destination is a link with a name, current or not', () => {
    draw('/threats');
    const nav = screen.getByRole('navigation', { name: label, hidden: true });
    for (const item of NAV_ITEMS) {
      const name = item.descriptor ? `${item.label}. ${item.descriptor}` : item.label;
      expect(within(nav).getByRole('link', { name, hidden: true })).toHaveAttribute(
        'href',
        item.href,
      );
    }
  });

  it('draws the indicator bar on the current item only, from the width token', () => {
    draw('/leaderboard');
    const nav = screen.getByRole('navigation', { name: label, hidden: true });
    const links = within(nav).getAllByRole('link', { hidden: true });
    for (const link of links) {
      const bar = link.querySelector(INDICATOR);
      // The account entry under the destinations is not a destination.
      if (link.getAttribute('href') === '/sign-in' || bar === null) continue;
      const current = link.getAttribute('aria-current') === 'page';
      expect(bar).toHaveAttribute('aria-hidden', 'true');
      expect(bar.className).toContain('w-(--nav-indicator-width)');
      expect(bar.className.includes('bg-nominal'), link.getAttribute('aria-label') ?? '').toBe(
        current,
      );
      expect(bar.className.includes('bg-transparent')).toBe(!current);
    }
    const bars = nav.querySelectorAll(INDICATOR);
    expect(bars).toHaveLength(NAV_ITEMS.length);
  });
});
