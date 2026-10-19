import { act, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { TerminalCard } from '@/components/about/TerminalCard';

/**
 * THE ABOUT TERMINALS (owner ruling 2026-10-18). The words are real DOM text
 * from the first byte; the typing is a layer over them. The server sends a
 * PENDING state (the final text present, drawn at opacity 0 only by CSS while
 * motion is allowed and script runs), so nothing flashes and then retypes,
 * and reduced motion lands on the finished state at once.
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
  // @ts-expect-error a test-only global
  delete window.IntersectionObserver;
});

it('sends the final words, pending, from the server', () => {
  const html = renderToString(<TerminalCard id="t" label="Test" command="whoami" lines={LINES} />);
  expect(html).toContain('data-state="pending"');
  expect(html).toContain('hello world');
  expect(html).toContain('whoami');
});

it('lands on the finished state at once under reduced motion', () => {
  mockReducedMotion(true);
  const { container } = render(<TerminalCard id="t" label="Test" command="whoami" lines={LINES} />);
  const card = container.querySelector('[data-terminal="t"]')!;
  expect(card).toHaveAttribute('data-state', 'done');
});

it('waits, pending, until it is scrolled into view', () => {
  mockReducedMotion(false);
  let trigger: (entries: { isIntersecting: boolean }[]) => void = () => {};
  // @ts-expect-error a test-only global
  window.IntersectionObserver = class {
    constructor(cb: typeof trigger) {
      trigger = cb;
    }
    observe() {}
    disconnect() {}
  };
  const { container } = render(<TerminalCard id="t" label="Test" command="whoami" lines={LINES} />);
  const card = container.querySelector('[data-terminal="t"]')!;
  expect(card).toHaveAttribute('data-state', 'pending');
  act(() => trigger([{ isIntersecting: true }]));
  expect(card).toHaveAttribute('data-state', 'typing');
});

it('is a labelled region whose typing layer is hidden from assistive technology', () => {
  mockReducedMotion(false);
  const { container, getByRole } = render(
    <TerminalCard id="t" label="Test terminal" command="whoami" lines={LINES} />,
  );
  expect(getByRole('region', { name: 'Test terminal' })).toBeInTheDocument();
  expect(container.querySelector('[data-terminal-typed]')).toHaveAttribute('aria-hidden', 'true');
});
