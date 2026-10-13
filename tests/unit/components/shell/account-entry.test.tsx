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
 * The entry lives in one of three places, by width, and is drawn in one of them
 * at a time: the top right of the header from 1100px (UI audit 2026-10-13,
 * batch E), the foot of the narrow rail from 760 to 1099px, and the foot of the
 * mobile drawer below that. On a phone the header is left alone: it has 5px to
 * spare at 320, and the mode chip that says where a run came from must never be
 * pushed off it.
 *
 * jsdom applies no stylesheet, so which copy is drawn is a class decision here
 * (`header-wide:`); the real widths are measured in
 * tests/e2e/header-account-entry.spec.ts.
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

  it('in the narrow rail the words go, and the names stay', () => {
    render(<CommandDeck pathname="/" account={SIGNED_IN} />);
    const rail = screen.getByRole('navigation', { name: 'Command deck' });

    // The rail carries the entry only while it is narrow, so it never writes
    // the long words or the address out; the accessible names do not depend on
    // either.
    expect(within(rail).queryByText('Your runs')).not.toBeInTheDocument();
    expect(within(rail).queryByText(EMAIL)).not.toBeInTheDocument();
    expect(
      within(rail).getByRole('link', { name: `Your runs, signed in as ${EMAIL}` }),
    ).toHaveAttribute('title', `Your runs, signed in as ${EMAIL}`);
    expect(within(rail).getByRole('button', { name: 'Sign out' })).toHaveAttribute(
      'title',
      'Sign out',
    );
  });
});

/**
 * FROM 1100PX THE HEADER CARRIES IT (UI audit 2026-10-13, batch E).
 *
 * The rail's copy lets go at the same line the header's takes up, so a reader
 * always has exactly one. Both are rendered; `display: none` on the one that is
 * not drawn keeps it out of the tab order and the accessibility tree.
 */
describe('the header carries the entry from 1100px, and the rail lets go of it there', () => {
  const classes = (el: Element) => el.className.split(/\s+/);
  const headerEntry = () => {
    const found = within(screen.getByRole('banner'))
      .getAllByTestId('account-entry')
      .filter((el) => el.getAttribute('data-account-placement') === 'header');
    expect(found).toHaveLength(1);
    return found[0]!;
  };

  it.each([
    ['signed out', SIGNED_OUT],
    ['signed in', SIGNED_IN],
    ['preview', PREVIEW],
  ] as const)('%s: the rail copy is not drawn from the line up', (_name, account) => {
    render(<CommandDeck pathname="/" account={account} />);
    const rail = screen.getByRole('navigation', { name: 'Command deck' });
    const railEntry = within(rail).getByTestId('account-entry');

    expect(railEntry).toHaveAttribute('data-account-placement', 'rail');
    expect(classes(railEntry)).toContain('header-wide:hidden');
    // Drawn below the line: no bare `hidden`.
    expect(classes(railEntry)).not.toContain('hidden');
  });

  it.each([
    ['signed out', SIGNED_OUT],
    ['signed in', SIGNED_IN],
    ['preview', PREVIEW],
  ] as const)('%s: the header copy is drawn from the line up only', (_name, account) => {
    render(<StatusBar pathname="/" account={account} />);

    // `hidden` below the line, a flex row from it: the exact opposite of the
    // rail's copy, on the same named breakpoint.
    expect(classes(headerEntry())).toEqual(expect.arrayContaining(['hidden', 'header-wide:flex']));
    expect(classes(headerEntry())).toContain('shrink-0');
  });

  it.each([
    ['no run on show', undefined, true],
    ['a sample run', 'sample', false],
  ] as const)(
    '%s: with the text enlarged the entry can drop to a row of its own',
    (_name, mode, inBar) => {
      render(<StatusBar pathname="/" mode={mode} account={SIGNED_OUT} />);
      const header = screen.getByRole('banner');
      const row = headerEntry().parentElement!;

      // Beside a chip it is an item of the header, which wraps. With no chip
      // it sits inside the bar, so there the bar has to wrap, from the line up
      // only: below it the bar holds nothing that could.
      expect(classes(header)).toContain('flex-wrap');
      expect(row === header).toBe(!inBar);
      if (inBar) expect(classes(row)).toContain('header-wide:flex-wrap');
      // The bar of a run screen never wraps: its telemetry is cut short instead.
      else expect(header.querySelector('.header-wide\\:flex-wrap')).toBeNull();
      // On a row of its own it stays at the right.
      expect(classes(headerEntry())).toContain('ml-auto');
    },
  );

  it('the drawer keeps its copy, and it is never hidden by class', () => {
    render(<StatusBar pathname="/" account={SIGNED_OUT} />);
    const drawerEntry = within(document.getElementById('mobile-deck')!).getByTestId(
      'account-entry',
    );

    expect(drawerEntry).toHaveAttribute('data-account-placement', 'drawer');
    expect(drawerEntry.className).not.toMatch(/hidden/);
    // Two copies under the header element: the drawer's (a closed popover) and
    // the bar's own.
    expect(within(screen.getByRole('banner')).getAllByTestId('account-entry')).toHaveLength(2);
  });

  it('signed out: one link, Sign in, back to the page you are on', () => {
    path.current = '/leaderboard';
    render(<StatusBar pathname="/leaderboard" account={SIGNED_OUT} />);

    const link = within(headerEntry()).getByRole('link', { name: 'Sign in' });
    expect(link).toHaveAttribute('href', '/sign-in?next=%2Fleaderboard');
    expect(link).toHaveAttribute('title', 'Sign in');
    expect(link).toHaveTextContent('Sign in');
    expect(within(headerEntry()).queryByText('PREVIEW')).not.toBeInTheDocument();
    expect(within(headerEntry()).queryByRole('button')).not.toBeInTheDocument();
    expect(within(headerEntry()).getAllByRole('link')).toHaveLength(1);
  });

  it('preview: still the way to sign-in, marked PREVIEW in the neutral state, never red', () => {
    render(<StatusBar pathname="/" account={PREVIEW} />);

    const link = within(headerEntry()).getByRole('link', {
      name: 'Sign in. Preview: sign-in is not set up on this build.',
    });
    expect(link).toHaveAttribute('href', '/sign-in?next=%2F');
    expect(link).toHaveTextContent('Sign in');
    const tag = within(headerEntry()).getByTestId('account-preview-tag');
    expect(tag).toHaveTextContent('PREVIEW');
    expect(tag.querySelector('svg')).not.toBeNull();
    expect(tag.style.color).toBe('var(--status-inert)');
    expect(tag.className).not.toMatch(/breach|caution/);
    expect(within(headerEntry()).queryByText('SIGNED IN')).not.toBeInTheDocument();
    expect(within(headerEntry()).queryByRole('button')).not.toBeInTheDocument();
  });

  it('signed in: Your runs and Sign out in the same place, and no Sign in', () => {
    render(<StatusBar pathname="/connect" account={SIGNED_IN} />);

    const runs = within(headerEntry()).getByRole('link', {
      name: `Your runs, signed in as ${EMAIL}`,
    });
    expect(runs).toHaveAttribute('href', '/account');
    expect(runs).toHaveAttribute('title', `Your runs, signed in as ${EMAIL}`);
    // The visible words are inside the accessible name (WCAG 2.5.3).
    expect(runs).toHaveTextContent('Your runs');
    const out = within(headerEntry()).getByRole('button', { name: 'Sign out' });
    expect(out).toHaveAttribute('type', 'submit');
    expect(out.closest('form')).not.toBeNull();
    expect(out).toHaveTextContent('Sign out');
    expect(within(headerEntry()).queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
    // Sign out is the last control: the rightmost thing in the header.
    const controls = [...headerEntry().querySelectorAll('a, button')];
    expect(controls.at(-1)).toBe(out);
    expect(headerEntry().textContent).not.toMatch(/—/);
  });

  it('signed in: says who, written out, wherever the bar is not full of a run', () => {
    render(<StatusBar pathname="/connect" account={SIGNED_IN} />);

    expect(within(headerEntry()).getByText('SIGNED IN')).toBeInTheDocument();
    const address = within(headerEntry()).getByText(EMAIL);
    // Long addresses are cut off on screen; the whole address stays available.
    expect(address).toHaveAttribute('title', EMAIL);
    expect(address.className).toMatch(/\btruncate\b/);
  });

  it('signed in, over a run: the address gives way to the run telemetry, and stays in the name', () => {
    render(
      <StatusBar
        pathname="/runs/x"
        mode="live"
        account={SIGNED_IN}
        runContext={{
          runId: 'x',
          model: 'some-model',
          category: 'ASI02',
          severity: 'High',
          compromised: true,
        }}
      />,
    );

    expect(within(headerEntry()).queryByText(EMAIL)).not.toBeInTheDocument();
    expect(within(headerEntry()).queryByText('SIGNED IN')).not.toBeInTheDocument();
    expect(
      within(headerEntry()).getByRole('link', { name: `Your runs, signed in as ${EMAIL}` }),
    ).toHaveAttribute('title', `Your runs, signed in as ${EMAIL}`);
    expect(within(headerEntry()).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it.each([
    ['signed out', SIGNED_OUT],
    ['signed in', SIGNED_IN],
    ['preview', PREVIEW],
  ] as const)('%s: every control in it asks for at least 44px each way', (_name, account) => {
    render(<StatusBar pathname="/" account={account} />);

    const controls = [...headerEntry().querySelectorAll('a, button')];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(classes(control)).toContain('target-min');
      // One line, so the header keeps its height.
      expect(classes(control)).toContain('whitespace-nowrap');
    }
  });

  it.each([
    ['no run on show', undefined],
    ['a sample run', 'sample'],
    ['a live run', 'live'],
  ] as const)('%s: the entry is the last thing in the header', (_name, mode) => {
    render(<StatusBar pathname="/" mode={mode} account={SIGNED_OUT} />);
    const header = screen.getByRole('banner');

    // In reading order nothing in the bar comes after it: not the chip, not
    // the telemetry. (The pulse is a line laid along the bar's edge, hidden
    // from assistive technology, and not a thing in the row.)
    const entryEl = headerEntry();
    const chip = within(header).queryByText(/^(SAMPLE|LIVE)$/);
    if (mode) {
      expect(chip).not.toBeNull();
      expect(
        chip!.compareDocumentPosition(entryEl) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    } else {
      expect(chip).toBeNull();
    }
    const after: Element[] = [];
    for (let el: Element | null = entryEl; el && el !== header; el = el.parentElement) {
      for (let next = el.nextElementSibling; next; next = next.nextElementSibling) {
        after.push(next);
      }
    }
    expect(after.filter((el) => !el.matches('[aria-hidden="true"]'))).toEqual([]);
  });
});

/**
 * THE HEADER TAG (batch E, then Batch G). The bar printed the design's internal
 * name, "SENTINEL FIELDS", beside the wordmark; batch E made it step aside on
 * the replay from 1100px. Batch G (2026-10-13, the owner's instruction) removes
 * that label from every page and width: no screen passes a tag now, so none is
 * drawn. The slot is still there for a screen that passes one, and on a run
 * screen such a tag still steps aside from the line up.
 */
describe('the header tag on a run screen', () => {
  const TAG = 'SOME TAG';
  const tag = () => screen.getByText(TAG);
  const RUN = {
    runId: 'x',
    model: 'some-model',
    category: 'ASI02',
    severity: 'High',
    compromised: true,
  };

  it('"SENTINEL FIELDS" is not drawn, with or without run telemetry', () => {
    const { unmount } = render(<StatusBar pathname="/" account={SIGNED_OUT} />);
    expect(screen.queryByText(/sentinel fields/i)).toBeNull();
    expect(document.querySelector('[data-header-tag]')).toBeNull();
    unmount();

    render(<StatusBar pathname="/runs/x" mode="sample" account={SIGNED_OUT} runContext={RUN} />);
    expect(screen.queryByText(/sentinel fields/i)).toBeNull();
    expect(document.querySelector('[data-header-tag]')).toBeNull();
  });

  it('a tag a screen passes is drawn from 760px where there is no run telemetry', () => {
    render(<StatusBar pathname="/" account={SIGNED_OUT} meta={TAG} />);

    expect(tag().className.split(/\s+/)).not.toContain('header-wide:hidden');
  });

  it('steps aside from the line up where the run telemetry is drawn', () => {
    render(
      <StatusBar
        pathname="/runs/x"
        mode="sample"
        account={SIGNED_OUT}
        runContext={RUN}
        meta={TAG}
      />,
    );

    expect(tag().className.split(/\s+/)).toContain('header-wide:hidden');
    // And the telemetry that takes its place is drawn from the same line.
    const telemetry = screen.getByText('some-model').parentElement!;
    expect(telemetry.className.split(/\s+/)).toContain('header-wide:block');
  });
});

/**
 * THE CHIP'S ROW NEVER REACHES PAST THE SCREEN (issue #221).
 *
 * Below 480px, on a screen that draws the mode chip, the header's two side
 * paddings are not fixed: the row can take them back. The chip may reach into
 * the right padding by exactly the padding, and no further (it used to reach
 * the padding plus 8px, and those 8px were past the screen); a zero-width item
 * on each side grows back into whatever room the row has left, up to the
 * padding it stands for. So a row that needs every pixel of the screen gets
 * it, a row that needs more wraps, and no row is drawn past the edge.
 */
describe('the chip row below 480px', () => {
  const classes = (el: Element) => el.className.split(/\s+/);

  it('the chip reaches into the right padding by exactly the padding, at each step', () => {
    render(<StatusBar pathname="/runs/x" mode="sample" />);
    const chip = screen.getByText('SAMPLE').parentElement!;
    const header = screen.getByRole('banner');

    // The header's padding, step by step, and the chip's negative right margin
    // at the same steps: the same amounts, read off both class lists.
    const steps = (el: Element, utility: RegExp) =>
      Object.fromEntries(
        classes(el)
          .map((c) => /^(?:(min-\[\d+px\]):)?(.+)$/.exec(c)!)
          .filter((m) => utility.test(m[2]!))
          .map((m) => [m[1] ?? 'base', m[2]!.replace(utility, '$1')]),
      );
    const padding = steps(header, /^px-(.+)$/);
    const reach = steps(chip, /^-mr-(.+)$/);

    expect(padding).toEqual({ base: '1', 'min-[360px]': '3', 'min-[420px]': '[18px]' });
    expect(reach).toEqual(padding);
    // And from 480px the chip has no margin of its own.
    expect(classes(chip)).toContain('min-[480px]:mr-0');
    expect(chip.className).not.toMatch(/-mr-5|-ml-\d/);
  });

  it.each(['header-start', 'header-end'])(
    '%s is a zero-width item that grows into the padding, and is gone from 480px',
    (id) => {
      render(<StatusBar pathname="/runs/x" mode="sample" />);
      const side = screen.getByTestId(id);

      expect(side).toHaveAttribute('aria-hidden', 'true');
      expect(classes(side)).toEqual(
        expect.arrayContaining(['shrink-0', 'basis-0', 'min-[480px]:hidden']),
      );
      // It grows as far as the padding it stands for, and no further.
      expect(classes(side)).toEqual(
        expect.arrayContaining(['max-w-1', 'min-[360px]:max-w-3', 'min-[420px]:max-w-[18px]']),
      );
    },
  );

  it('the left side takes the room first, so a row that fits is drawn as it always was', () => {
    render(<StatusBar pathname="/runs/x" mode="sample" />);
    const grow = (id: string) =>
      Number(/(?:^|\s)grow-\[(\d+)\]/.exec(screen.getByTestId(id).className)?.[1]);

    expect(grow('header-start')).toBeGreaterThan(grow('header-end'));
    expect(grow('header-end')).toBeGreaterThan(1);
  });

  it('a screen with no chip has neither, and keeps its padding', () => {
    render(<StatusBar pathname="/" />);

    expect(screen.queryByTestId('header-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('header-end')).not.toBeInTheDocument();
  });
});
