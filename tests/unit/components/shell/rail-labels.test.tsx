import { render, screen, within } from '@testing-library/react';
import { CommandDeck } from '@/components/shell/CommandDeck';
import { MobileDrawer } from '@/components/shell/MobileDrawer';
import { NAV_ITEMS } from '@/components/shell/nav-items';
import type { ShellAccount } from '@/lib/shell-account';

/**
 * THE RAIL NAMES ITS LINKS IN WORDS ON A TABLET, NOT ONLY ON HOVER (S4).
 *
 * From 760 to 1099px the command deck is a narrow rail. It used to show icons
 * only, named by `aria-label` and `title`, and a touch screen has no tooltip.
 * Now each link carries a short visible word under its icon. Two rules:
 *
 *  - the accessible names are EXACTLY what they were (written out here, not
 *    derived, so a change to either side shows up);
 *  - the visible word is inside the accessible name (WCAG 2.5.3 Label in Name),
 *    and it is aria-hidden, so a screen reader hears the name once.
 *
 * Which word shows at which width is a class decision; the real widths are
 * measured in tests/e2e/rail-visible-labels.spec.ts.
 */

const EMAIL = 'dame@example.com';
const SIGNED_OUT: ShellAccount = { state: 'signed-out' };
const SIGNED_IN: ShellAccount = { state: 'signed-in', email: EMAIL };
const PREVIEW: ShellAccount = { state: 'preview' };

/** Today's accessible names, unchanged by this fix. */
const DECK_NAMES = [
  'Home',
  'Connect / Run. point your own agent at an endpoint and run it',
  'Live Replay. watch a recorded attack step by step',
  'Leaderboard',
  'Findings',
  'Threat Model',
] as const;

/** The marker the rail's short visible word carries. */
const SHORT = '[data-rail-label]';

function railLinks(account: ShellAccount = SIGNED_OUT) {
  render(<CommandDeck pathname="/" account={account} />);
  return screen.getByRole('navigation', { name: 'Command deck' });
}

describe('nav items: a short label for the narrow rail', () => {
  it('gives every destination a one- or two-word label of at most eight characters', () => {
    for (const item of NAV_ITEMS) {
      expect(item.short, item.href).toMatch(/^\S+( \S+)?$/);
      expect(item.short.length, item.href).toBeLessThanOrEqual(8);
    }
  });

  it('keeps each short label inside the accessible name (Label in Name)', () => {
    NAV_ITEMS.forEach((item, i) => {
      expect(DECK_NAMES[i]!.toLowerCase()).toContain(item.short.toLowerCase());
    });
  });
});

describe('CommandDeck: visible words in the narrow rail', () => {
  it('keeps every link name exactly as it was', () => {
    const rail = railLinks();
    const names = within(rail)
      .getAllByRole('link')
      .slice(0, DECK_NAMES.length)
      .map((link) => link.getAttribute('aria-label'));
    expect(names).toEqual([...DECK_NAMES]);
    for (const name of DECK_NAMES) {
      expect(within(rail).getByRole('link', { name })).toHaveAttribute('title', name);
    }
  });

  it('shows a short word under each icon below 1100px, hidden from the accessibility tree', () => {
    const rail = railLinks();
    DECK_NAMES.forEach((name, i) => {
      const link = within(rail).getByRole('link', { name });
      const short = link.querySelector(SHORT);
      expect(short, name).not.toBeNull();
      expect(short!.textContent).toBe(NAV_ITEMS[i]!.short);
      expect(short).toHaveAttribute('aria-hidden', 'true');
      // Shown in the narrow rail, gone in the wide one, an INSTRUMENT label on one line.
      expect(short!.className).toMatch(/(^| )header-wide:hidden( |$)/);
      expect(short!.className).not.toMatch(/(^| )hidden( |$)/);
      expect(short!.className).toMatch(/(^| )instrument( |$)/);
      expect(short!.className).toMatch(/(^| )one-line( |$)/);
      expect(short!.className).toMatch(/whitespace-nowrap/);
    });
  });

  it('keeps the full label for the wide rail only', () => {
    const rail = railLinks();
    for (const item of NAV_ITEMS) {
      const full = within(rail).getByText(item.label, { selector: `span:not(${SHORT})` });
      expect(full.className).toMatch(/hidden header-wide:inline/);
    }
  });

  it('stacks the word under the icon below 1100px only, and keeps the wide row as it was', () => {
    const rail = railLinks();
    for (const name of DECK_NAMES) {
      const cls = within(rail).getByRole('link', { name }).className.split(/\s+/);
      expect(cls).toContain('max-header-wide:flex-col');
      // 44px minimum target in the narrow rail.
      expect(cls).toContain('max-header-wide:min-h-11');
      // Every unprefixed class is the wide rail's, exactly as before.
      expect(cls.filter((c) => !c.includes(':'))).toEqual(
        expect.arrayContaining(['flex', 'items-center', 'gap-3', 'px-3.5', 'py-3.5']),
      );
      expect(cls).not.toContain('flex-col');
    }
  });

  it('is wider in the narrow band than the old 72px icon rail', () => {
    const rail = railLinks();
    expect(rail.className).not.toMatch(/w-\[72px\]/);
    expect(rail.className).toMatch(/header-wide:w-\[236px\]/);
  });
});

describe('AccountEntry in the narrow rail', () => {
  it.each([
    ['signed out', SIGNED_OUT, [['link', 'Sign in', 'Sign in']]],
    [
      'signed in',
      SIGNED_IN,
      [
        ['link', `Your runs, signed in as ${EMAIL}`, 'Runs'],
        ['button', 'Sign out', 'Sign out'],
      ],
    ],
    [
      'preview',
      PREVIEW,
      [['link', 'Sign in. Preview: sign-in is not set up on this build.', 'Sign in']],
    ],
  ] as const)('%s: names unchanged, a visible word inside each', (_s, account, controls) => {
    const rail = railLinks(account);
    for (const [role, name, word] of controls) {
      const control = within(rail).getByRole(role, { name });
      expect(control).toHaveAttribute('aria-label', name);
      const short = control.querySelector(SHORT);
      expect(short, name).not.toBeNull();
      expect(short!.textContent).toBe(word);
      expect(short).toHaveAttribute('aria-hidden', 'true');
      expect(name.toLowerCase()).toContain(word.toLowerCase());
      expect(short!.className).toMatch(/(^| )header-wide:hidden( |$)/);
      expect(control.className.split(/\s+/)).toContain('max-header-wide:flex-col');
      expect(control.className.split(/\s+/)).not.toContain('flex-col');
    }
  });
});

describe('MobileDrawer is unchanged', () => {
  it('draws no short rail word and keeps its row layout', () => {
    render(<MobileDrawer pathname="/" account={SIGNED_IN} />);
    const drawer = document.getElementById('mobile-deck')!;
    expect(drawer.querySelectorAll(SHORT)).toHaveLength(0);
    for (const name of DECK_NAMES) {
      const link = within(drawer).getByRole('link', { name, hidden: true });
      expect(link.className).not.toMatch(/flex-col/);
    }
  });
});
