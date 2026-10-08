import { render, screen, within } from '@testing-library/react';
import { AccountEntry, signInHref } from '@/components/shell/AccountEntry';
import { CommandDeck } from '@/components/shell/CommandDeck';
import { MobileDrawer } from '@/components/shell/MobileDrawer';
import { StatusBar } from '@/components/shell/StatusBar';
import type { ShellAccount } from '@/lib/shell-identity';

/**
 * THE SHELL HAS A WAY IN, AND A WAY OUT (sweep 2026-10-07, X2).
 *
 * Nothing in the shell linked to `/sign-in` or `/account`. Sign-in was reachable
 * by typing the address or from inside Connect's live gate, and the only sign-out
 * control sat on a page nothing pointed at.
 *
 * The entry lives at the bottom of the command deck (the rail) and of the mobile
 * drawer. The header is left alone: it has 5px to spare at 320, and the mode chip
 * that says where a run came from must never be pushed off it.
 */

const path = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => path.current,
}));
// The sign-out form posts the real server action; here it only has to be the
// action the form is bound to.
vi.mock('@/lib/auth/actions', () => ({ signOut: vi.fn() }));

const SIGNED_OUT: ShellAccount = { state: 'signed-out' };
const PREVIEW: ShellAccount = { state: 'preview' };
const EMAIL = 'dame@example.com';
const SIGNED_IN: ShellAccount = { state: 'signed-in', email: EMAIL };

const entry = () => screen.getByTestId('account-entry');

beforeEach(() => {
  path.current = '/';
});

describe('AccountEntry · signed out, auth configured', () => {
  it('is one link, Sign in, that comes back to the page you were on', () => {
    path.current = '/leaderboard';
    render(<AccountEntry account={SIGNED_OUT} pathname="/leaderboard" />);

    const link = within(entry()).getByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', '/sign-in?next=%2Fleaderboard');
    expect(link).toHaveTextContent('Sign in');
    expect(within(entry()).queryByText('PREVIEW')).not.toBeInTheDocument();
    expect(within(entry()).queryByRole('button')).not.toBeInTheDocument();
    expect(entry().textContent).not.toMatch(/—/);
  });

  it('follows the live path, not the one the layout was first rendered with', () => {
    // The shell layout does not re-render on a client navigation, so the path it
    // was handed goes stale. The link reads the router's.
    path.current = '/threats';
    render(<AccountEntry account={SIGNED_OUT} pathname="/" />);

    expect(within(entry()).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in?next=%2Fthreats',
    );
  });
});

describe('signInHref · the return path', () => {
  it.each([
    ['/', '/sign-in?next=%2F'],
    ['/connect', '/sign-in?next=%2Fconnect'],
    ['/runs/sample', '/sign-in?next=%2Fruns%2Fsample'],
    ['/findings/asi10-goal-drift', '/sign-in?next=%2Ffindings%2Fasi10-goal-drift'],
  ])('%s -> %s', (from, href) => {
    expect(signInHref(from)).toBe(href);
  });

  it.each([
    ['/sign-in', 'never points sign-in back at itself'],
    ['/sign-in/', 'nor with a trailing slash'],
    ['//evil.example', 'a protocol-relative path fails the sanitiser'],
    ['https://evil.example/', 'an absolute URL fails the sanitiser'],
    ['/\\evil.example', 'a backslash fails the sanitiser'],
    ['', 'an empty path has nothing to return to'],
  ])('%j carries no next (%s)', (from) => {
    expect(signInHref(from)).toBe('/sign-in');
  });
});

describe('AccountEntry · signed in', () => {
  beforeEach(() => {
    path.current = '/connect';
    render(<AccountEntry account={SIGNED_IN} pathname="/connect" />);
  });

  it('says who is signed in', () => {
    expect(within(entry()).getByText('SIGNED IN')).toBeVisible();
    const email = within(entry()).getByText(EMAIL);
    expect(email).toBeVisible();
    // Long addresses are cut off on screen; the whole address stays available.
    expect(email).toHaveAttribute('title', EMAIL);
  });

  it('links to the account page, named for what is there and for whom', () => {
    const link = within(entry()).getByRole('link', {
      name: `Your runs, signed in as ${EMAIL}`,
    });
    expect(link).toHaveAttribute('href', '/account');
    // The visible words are inside the accessible name (WCAG 2.5.3).
    expect(link).toHaveTextContent('Your runs');
  });

  it('offers Sign out as a real form post, so it works before any script loads', () => {
    const button = within(entry()).getByRole('button', { name: 'Sign out' });
    expect(button).toHaveAttribute('type', 'submit');
    expect(button.closest('form')).not.toBeNull();
    expect(button).toHaveTextContent('Sign out');
  });

  it('offers no Sign in link, and no em dash', () => {
    expect(within(entry()).queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
    expect(entry().textContent).not.toMatch(/—/);
  });
});

describe('AccountEntry · PREVIEW, auth not configured', () => {
  beforeEach(() => {
    path.current = '/';
    render(<AccountEntry account={PREVIEW} pathname="/" />);
  });

  it('is still a way to the sign-in page, and says plainly that it is a preview', () => {
    const link = within(entry()).getByRole('link', {
      name: 'Sign in. Preview: sign-in is not set up on this build.',
    });
    expect(link).toHaveAttribute('href', '/sign-in?next=%2F');
    expect(link).toHaveTextContent('Sign in');
    expect(within(entry()).getByText('PREVIEW')).toBeVisible();
  });

  it('marks the preview with the neutral state, an icon and a label, never red', () => {
    const tag = within(entry()).getByText('PREVIEW').closest('[data-testid="account-preview-tag"]');
    expect(tag).not.toBeNull();
    expect(tag!.querySelector('svg')).not.toBeNull();
    expect((tag as HTMLElement).style.color).toBe('var(--status-inert)');
    expect(tag!.className).not.toMatch(/breach|caution/);
  });

  it('claims no account and offers no sign-out', () => {
    expect(within(entry()).queryByText('SIGNED IN')).not.toBeInTheDocument();
    expect(within(entry()).queryByRole('button')).not.toBeInTheDocument();
    expect(entry().textContent).not.toMatch(/—/);
  });
});

describe('AccountEntry · every control is a full-size target', () => {
  it.each([
    ['signed out', SIGNED_OUT],
    ['signed in', SIGNED_IN],
    ['preview', PREVIEW],
  ] as const)('%s: each link and button asks for at least 44px', (_name, account) => {
    render(<AccountEntry account={account} pathname="/" />);

    const controls = [
      ...within(entry()).queryAllByRole('link'),
      ...within(entry()).queryAllByRole('button'),
    ];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.className).toMatch(/\bmin-h-11\b/);
  });
});

describe('where the entry lives', () => {
  it.each([
    ['signed out', SIGNED_OUT, 'Sign in'],
    ['signed in', SIGNED_IN, `Your runs, signed in as ${EMAIL}`],
    ['preview', PREVIEW, 'Sign in. Preview: sign-in is not set up on this build.'],
  ] as const)('the rail renders it, %s', (_name, account, name) => {
    render(<CommandDeck pathname="/" account={account} />);

    const rail = screen.getByRole('navigation', { name: 'Command deck' });
    expect(within(rail).getByRole('link', { name })).toBeInTheDocument();
    // Below the destinations: the last thing in the rail.
    expect(rail.lastElementChild).toBe(within(rail).getByTestId('account-entry'));
  });

  it.each([
    ['signed out', SIGNED_OUT, 'Sign in'],
    ['signed in', SIGNED_IN, `Your runs, signed in as ${EMAIL}`],
    ['preview', PREVIEW, 'Sign in. Preview: sign-in is not set up on this build.'],
  ] as const)('the mobile drawer renders it, %s', (_name, account, name) => {
    render(<MobileDrawer pathname="/" account={account} />);

    const drawer = document.getElementById('mobile-deck')!;
    expect(within(drawer).getByRole('link', { name, hidden: true })).toBeInTheDocument();
  });

  it('in the icon-only rail the words go, and the names stay', () => {
    render(<CommandDeck pathname="/" account={SIGNED_IN} />);
    const rail = screen.getByRole('navigation', { name: 'Command deck' });

    // The label text is hidden below 1100px by class; the accessible names do
    // not depend on it.
    expect(within(rail).getByText('Your runs').className).toMatch(/hidden min-\[1100px\]:inline/);
    expect(
      within(rail).getByRole('link', { name: `Your runs, signed in as ${EMAIL}` }),
    ).toHaveAttribute('title', `Your runs, signed in as ${EMAIL}`);
    expect(within(rail).getByRole('button', { name: 'Sign out' })).toHaveAttribute(
      'title',
      'Sign out',
    );
  });

  it('the header bar itself draws none of it, signed in or out', () => {
    render(<StatusBar pathname="/" account={{ state: 'signed-in', email: EMAIL }} />);

    // The drawer's markup sits inside the <header> element (its menu button is
    // in the bar), but it is a closed popover, not part of the bar. So: the one
    // entry under the header is the drawer's, and the bar shows no account
    // control of its own.
    const header = screen.getByRole('banner');
    const entries = within(header).queryAllByTestId('account-entry');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.closest('#mobile-deck')).not.toBeNull();
    // Role queries skip what is hidden, and a closed popover is hidden.
    expect(within(header).queryByRole('link', { name: /sign in|your runs/i })).toBeNull();
    expect(within(header).queryByRole('button', { name: /sign out/i })).toBeNull();
  });
});
