import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileDrawer } from '@/components/shell/MobileDrawer';

/**
 * THE DRAWER CLOSES WHEN YOU GO SOMEWHERE (mobile sweep 2026-10-10, S2).
 *
 * The drawer is a native popover in a layout, and Next does not re-render a
 * layout on a client navigation, so nothing used to close it: tapping
 * Leaderboard changed the URL and left the menu lying over the new page.
 *
 * jsdom has no Popover API, so the drawer element gets a small stand-in for the
 * two members the shell uses (`:popover-open` and `hidePopover`). The real
 * engines are covered by `tests/e2e/drawer-closes-on-navigate.spec.ts`.
 */

let pathname = '/connect';
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => pathname,
}));

/** Give the drawer a popover state jsdom does not have. Starts open. */
function fakePopover(drawer: HTMLElement) {
  const state = { open: true };
  const nativeMatches = drawer.matches.bind(drawer);
  const matches = (selector: string) =>
    selector === ':popover-open' ? state.open : nativeMatches(selector);
  const hidePopover = vi.fn(() => {
    if (!state.open) throw new DOMException('not open', 'InvalidStateError');
    state.open = false;
  });
  Object.assign(drawer, { matches, hidePopover });
  return { state, hidePopover };
}

function renderDrawer() {
  const view = render(<MobileDrawer pathname={pathname} account={{ state: 'signed-out' }} />);
  const drawer = document.getElementById('mobile-deck')!;
  const trigger = screen.getByRole('button', { name: 'Open command deck' });
  return { view, drawer, trigger, ...fakePopover(drawer) };
}

/** Clicks reach jsdom's link activation; stop it navigating the test window. */
function stopNavigation(event: Event) {
  event.preventDefault();
}

beforeEach(() => {
  pathname = '/connect';
  document.addEventListener('click', stopNavigation);
});
afterEach(() => {
  document.removeEventListener('click', stopNavigation);
});

describe('close on a link inside the drawer', () => {
  it('a plain click on a destination closes the drawer and focuses the menu button', () => {
    const { drawer, trigger, state, hidePopover } = renderDrawer();
    const link = drawer.querySelector<HTMLAnchorElement>('a[href="/leaderboard"]')!;
    link.focus();

    fireEvent.click(link);

    expect(hidePopover).toHaveBeenCalledTimes(1);
    expect(state.open).toBe(false);
    expect(trigger).toHaveFocus();
  });

  it('a click on the account entry closes it too', () => {
    const { drawer, trigger, state } = renderDrawer();
    const signIn = drawer.querySelector<HTMLAnchorElement>(
      '[data-testid="account-entry"] a[href]',
    )!;

    fireEvent.click(signIn);

    expect(state.open).toBe(false);
    expect(trigger).toHaveFocus();
  });

  it('a click on the link to the page you are already on still closes it', () => {
    const { drawer, state } = renderDrawer();

    fireEvent.click(drawer.querySelector('a[href="/connect"]')!);

    expect(state.open).toBe(false);
  });

  it('a click on the icon inside a link counts as a click on the link', () => {
    const { drawer, state } = renderDrawer();
    const icon = drawer.querySelector('a[href="/threats"] svg')!;

    fireEvent.click(icon);

    expect(state.open).toBe(false);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['the middle button', { button: 1 }],
  ])('a click with %s opens elsewhere, so the drawer stays open', (_name, init) => {
    const { drawer, hidePopover } = renderDrawer();

    fireEvent.click(drawer.querySelector('a[href="/leaderboard"]')!, init);

    expect(hidePopover).not.toHaveBeenCalled();
  });

  it('a click inside the drawer that is not on a link leaves it open', () => {
    const { drawer, hidePopover } = renderDrawer();

    fireEvent.click(drawer.querySelector('nav')!);

    expect(hidePopover).not.toHaveBeenCalled();
  });
});

describe('close on a route change', () => {
  it('a new pathname (Back, Forward, a link on the page) closes an open drawer and focuses the menu button', () => {
    const { view, trigger, state, hidePopover } = renderDrawer();

    pathname = '/leaderboard';
    act(() => {
      view.rerender(<MobileDrawer pathname="/connect" account={{ state: 'signed-out' }} />);
    });

    expect(hidePopover).toHaveBeenCalledTimes(1);
    expect(state.open).toBe(false);
    expect(trigger).toHaveFocus();
  });

  it('a route change with the drawer already closed touches nothing, focus included', () => {
    const { view, state, hidePopover } = renderDrawer();
    state.open = false;
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();

    pathname = '/threats';
    act(() => {
      view.rerender(<MobileDrawer pathname="/connect" account={{ state: 'signed-out' }} />);
    });

    expect(hidePopover).not.toHaveBeenCalled();
    expect(elsewhere).toHaveFocus();
    elsewhere.remove();
  });

  it('the first render is not a route change: an open drawer stays open', () => {
    const { hidePopover } = renderDrawer();

    expect(hidePopover).not.toHaveBeenCalled();
  });

  it('a re-render on the same pathname leaves an open drawer open', () => {
    const { view, hidePopover } = renderDrawer();

    act(() => {
      view.rerender(<MobileDrawer pathname="/connect" account={{ state: 'signed-out' }} />);
    });

    expect(hidePopover).not.toHaveBeenCalled();
  });
});

describe('without the Popover API', () => {
  it('a click on a link does not throw where the platform has no popover', () => {
    render(<MobileDrawer pathname={pathname} account={{ state: 'signed-out' }} />);
    const drawer = document.getElementById('mobile-deck')!;

    expect(() => fireEvent.click(drawer.querySelector('a[href="/leaderboard"]')!)).not.toThrow();
  });
});
