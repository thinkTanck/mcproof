import { render, screen, within } from '@testing-library/react';
import { AppShell } from '@/components/shell/AppShell';
import { MobileDrawer } from '@/components/shell/MobileDrawer';

// AppShell reads the active route from the x-pathname request header.
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k === 'x-pathname' ? '/' : null) }),
}));

const DECK_LINKS = [
  'Home',
  'Connect / Run',
  'Live Replay',
  'Leaderboard',
  'Findings',
  'Threat Model',
];

describe('AppShell (server shell)', () => {
  it('exposes banner, navigation and main landmarks with the six deck links', async () => {
    render(await AppShell({ children: <p>screen content</p> }));
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    const deck = screen.getByRole('navigation', { name: 'Command deck' });
    // Substring match: some links carry a purpose descriptor in their accessible
    // name (see the descriptor test below), so the deck label is a prefix, not the
    // whole name.
    for (const name of DECK_LINKS) {
      expect(within(deck).getByRole('link', { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it('gives the action routes a purpose descriptor in their accessible name', async () => {
    render(await AppShell({ children: <p>screen content</p> }));
    const deck = screen.getByRole('navigation', { name: 'Command deck' });
    // A newcomer should not have to click to learn what these do.
    expect(
      within(deck).getByRole('link', { name: /Live Replay.*watch a recorded attack/i }),
    ).toBeInTheDocument();
    expect(
      within(deck).getByRole('link', { name: /Connect \/ Run.*point your own agent/i }),
    ).toBeInTheDocument();
  });

  it('carries no Fleet Status tally: it was a fabricated stat and was removed', async () => {
    render(await AppShell({ children: <p>screen content</p> }));
    // The tri-state tally was tallied from a hardcoded placeholder leaderboard, not
    // real runs. A fabricated stat next to the measured figures discredits them, so
    // the whole widget is gone from the shell.
    expect(screen.queryByRole('region', { name: /fleet status/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ nominal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ caution/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ breach/i)).not.toBeInTheDocument();
  });

  it('marks the active route (Home at "/") with aria-current="page"', async () => {
    render(await AppShell({ children: <p>screen content</p> }));
    const deck = screen.getByRole('navigation', { name: 'Command deck' });
    expect(within(deck).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('renders the mobile command-deck trigger + drawer nav (native popover, no JS)', async () => {
    render(await AppShell({ children: <p>screen content</p> }));
    const trigger = screen.getByRole('button', { name: 'Open command deck' });
    expect(trigger).toHaveAttribute('popovertarget', 'mobile-deck');
    // The drawer is a closed native popover (display:none until opened), so its
    // nav is queried as hidden; the open/close behaviour is covered by e2e.
    const mobileNav = screen.getByRole('navigation', {
      name: 'Command deck (mobile)',
      hidden: true,
    });
    for (const name of DECK_LINKS) {
      expect(
        within(mobileNav).getByRole('link', { name: new RegExp(name), hidden: true }),
      ).toBeInTheDocument();
    }
  });
});

describe('MobileDrawer', () => {
  it('marks the active route inside the popover drawer', () => {
    render(<MobileDrawer pathname="/leaderboard" account={{ state: 'signed-out' }} />);
    const nav = screen.getByRole('navigation', { name: 'Command deck (mobile)', hidden: true });
    expect(within(nav).getByRole('link', { name: 'Leaderboard', hidden: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
