import { act, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { TerminalCard } from '@/components/about/TerminalCard';

/**
 * THE ABOUT TERMINALS (owner rulings 2026-10-18 and ABOUT REVISION, 2026-10-19).
 * The words are real DOM text from the first byte; the typing is a layer over
 * them. The server sends PENDING, so nothing flashes and then retypes; reduced
 * motion lands on the finished state at once. A card types only when it is
 * told to start, and says when it is done, so the page can run two in turn.
 */

const LINES = [{ kind: 'out' as const, text: 'hello world' }];

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  vi.useRealTimers();
});

it('sends the final words, pending, from the server, under the visitor prompt', () => {
  const html = renderToString(
    <TerminalCard id="t" label="Test" command="whoami" lines={LINES} start={false} />,
  );
  expect(html).toContain('data-state="pending"');
  expect(html).toContain('hello world');
  expect(html).toContain('visitor@mcproof:~$');
});

it('lands on the finished state at once under reduced motion', () => {
  mockReducedMotion(true);
  const { container } = render(
    <TerminalCard id="t" label="Test" command="whoami" lines={LINES} start={false} />,
  );
  expect(container.querySelector('[data-terminal="t"]')).toHaveAttribute('data-state', 'done');
});

it('waits, pending, until told to start; then types, and says when it is done', () => {
  mockReducedMotion(false);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  const onDone = vi.fn();
  const { container, rerender } = render(
    <TerminalCard
      id="t"
      label="Test"
      command="whoami"
      lines={LINES}
      start={false}
      onDone={onDone}
    />,
  );
  const card = container.querySelector('[data-terminal="t"]')!;
  expect(card).toHaveAttribute('data-state', 'pending');
  rerender(
    <TerminalCard id="t" label="Test" command="whoami" lines={LINES} start onDone={onDone} />,
  );
  expect(card).toHaveAttribute('data-state', 'typing');
  expect(onDone).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(card).toHaveAttribute('data-state', 'done');
  expect(onDone).toHaveBeenCalledTimes(1);
});

it('is a labelled region whose typing layer is hidden from assistive technology', () => {
  mockReducedMotion(false);
  const { container, getByRole } = render(
    <TerminalCard id="t" label="Test terminal" command="whoami" lines={LINES} start={false} />,
  );
  expect(getByRole('region', { name: 'Test terminal' })).toBeInTheDocument();
  expect(container.querySelector('[data-terminal-typed]')).toHaveAttribute('aria-hidden', 'true');
});
