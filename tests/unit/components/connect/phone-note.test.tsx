import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectScreen } from '@/components/connect/ConnectScreen';
import * as copy from '@/components/connect/phone-note-copy';
import { PHONE_NOTE_LINKS, PHONE_NOTE_TEXT } from '@/components/connect/phone-note-copy';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

/**
 * THE PHONE NOTE ON CONNECT.
 *
 * Running a test needs a terminal or a code editor, which a phone does not
 * have. Below 768px the screen says so first, in the inert state (it is
 * information, not a warning and not a breach), and points at the three things
 * a phone visitor can do instead. Nothing else on the screen changes.
 *
 * jsdom applies no media queries, so "hidden from 768px up" is held here as a
 * class contract and proven in a real browser by tests/e2e/connect-phone-note.spec.ts.
 */

const note = () => screen.getByRole('note');
const modeSwitch = () => screen.getByRole('group', { name: 'Run mode' });
const goLive = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /LIVE · your agent connects to us/i }));

describe('Connect phone note · the approved words', () => {
  it('is the approved sentence, exactly', () => {
    expect(PHONE_NOTE_TEXT).toBe(
      'Running a test needs a computer with a terminal or code editor. From your phone you can watch a sample run, read a fix report, and check the leaderboard.',
    );
  });

  it('names three links with the approved labels and targets, in order', () => {
    expect(PHONE_NOTE_LINKS).toEqual([
      { label: 'Watch a sample run', href: '/runs/sample' },
      { label: 'Read a fix report', href: '/findings/sample' },
      { label: 'See the leaderboard', href: '/leaderboard' },
    ]);
  });

  it('has no em dash anywhere in its copy', () => {
    const words = [PHONE_NOTE_TEXT, ...PHONE_NOTE_LINKS.map((l) => l.label)];
    for (const text of words) expect(text).not.toMatch(/[–—]/);
  });
});

describe('Connect phone note · on the screen', () => {
  it('shows the sentence and the three links in SAMPLE mode', () => {
    render(<ConnectScreen />);

    expect(within(note()).getByText(PHONE_NOTE_TEXT)).toBeInTheDocument();
    const links = within(note()).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Watch a sample run', '/runs/sample'],
      ['Read a fix report', '/findings/sample'],
      ['See the leaderboard', '/leaderboard'],
    ]);
    for (const { label } of PHONE_NOTE_LINKS) {
      expect(within(note()).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('shows the same note in LIVE mode, signed out and signed in', async () => {
    for (const signedIn of [false, true]) {
      const user = userEvent.setup();
      const { unmount } = render(<ConnectScreen signedIn={signedIn} />);
      await goLive(user);

      expect(within(note()).getByText(PHONE_NOTE_TEXT)).toBeInTheDocument();
      expect(within(note()).getAllByRole('link')).toHaveLength(3);
      unmount();
    }
  });

  it('is drawn once, and sits before the mode switch in document order', () => {
    render(<ConnectScreen />);

    expect(screen.getAllByRole('note')).toHaveLength(1);
    expect(
      note().compareDocumentPosition(modeSwitch()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('is hidden from 768px up by class, and by nothing below that', () => {
    render(<ConnectScreen />);

    const classes = [...note().classList];
    expect(classes).toContain('md:hidden');
    // No class that would hide it on a phone as well.
    expect(classes.filter((c) => /(^|:)(hidden|invisible|sr-only|collapse)$/.test(c))).toEqual([
      'md:hidden',
    ]);
    expect(note()).not.toHaveAttribute('hidden');
    expect(note()).not.toHaveAttribute('aria-hidden');
  });

  it('carries no label above the sentence: the note opens on its text', () => {
    render(<ConnectScreen />);

    expect(Object.keys(copy)).not.toContain('PHONE_NOTE_LABEL');
    expect(note().textContent).not.toMatch(/on a phone/i);
    expect(note().querySelector('.micro-label')).toBeNull();
    // The first words in the note are the sentence's own.
    expect(note().textContent?.trim().startsWith('Running a test needs')).toBe(true);
  });

  it('is information: an inert mark beside the sentence, never red and never caution', () => {
    render(<ConnectScreen />);

    const icons = note().querySelectorAll('svg');
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon).toHaveAttribute('aria-hidden', 'true');

    // The mark keeps the inert colour it had, now beside the sentence.
    const mark = note().querySelector<SVGElement>('[data-testid="phone-note-mark"]');
    expect(mark).not.toBeNull();
    expect(mark!.closest('[style*="--status-inert"]')).not.toBeNull();
    const sentence = within(note()).getByText(PHONE_NOTE_TEXT);
    expect(mark!.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    for (const el of [note(), ...note().querySelectorAll<HTMLElement>('*')]) {
      const paint = `${el.getAttribute('class') ?? ''} ${el.getAttribute('style') ?? ''}`;
      expect(paint).not.toMatch(/breach|caution|amber|danger|red-/);
    }
    // Not an alert and not a live region: it announces nothing by itself.
    expect(note()).not.toHaveAttribute('aria-live');
    expect(note().querySelector('[role="alert"], [role="status"], [aria-live]')).toBeNull();
  });

  it('wears the READING role for its sentence, on the measure', () => {
    render(<ConnectScreen />);

    const sentence = within(note()).getByText(PHONE_NOTE_TEXT);
    expect(sentence.tagName).toBe('P');
    expect(sentence).toHaveClass('reading', 'measure');
    expect(sentence).not.toHaveClass('micro-label');
  });

  it('cannot be dismissed, traps no focus and moves nothing', () => {
    render(<ConnectScreen />);

    expect(within(note()).queryByRole('button')).toBeNull();
    expect(note().querySelector('[tabindex], [autofocus], dialog, [role="dialog"]')).toBeNull();
    for (const el of [note(), ...note().querySelectorAll<HTMLElement>('*')]) {
      expect(el.getAttribute('class') ?? '').not.toMatch(/animate-|panel-in/);
    }
  });

  it('gives each link a 44px floor by class', () => {
    render(<ConnectScreen />);

    for (const link of within(note()).getAllByRole('link')) expect(link).toHaveClass('min-h-11');
  });

  it('leaves the rest of Connect in place and enabled', async () => {
    const user = userEvent.setup();
    const { container } = render(<ConnectScreen />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Set up a red-team run.');
    expect(screen.getAllByRole('radio')).toHaveLength(7);
    expect(screen.getByRole('link', { name: /play sample run/i })).toBeInTheDocument();
    expect(container.querySelector('[disabled], [aria-disabled="true"]')).toBeNull();

    await goLive(user);
    expect(
      screen.getByRole('button', { name: /LIVE · your agent connects to us/i }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
