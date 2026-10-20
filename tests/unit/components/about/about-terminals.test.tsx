import { act, render } from '@testing-library/react';
import { AboutTerminals } from '@/components/about/AboutTerminals';

/**
 * WHEN EACH /about TERMINAL TYPES (owner ruling ABOUT REVISION, 2026-10-19):
 *
 *  - whoami streams on page load;
 *  - Why Sentinel streams only when scrolled to: after a user scroll, once
 *    the terminal is at least 60% in view;
 *  - already 60% in view at load, with no scroll, it starts after whoami
 *    finishes;
 *  - never both typing at once.
 *
 * The browser's IntersectionObserver is replaced by one this test drives, and
 * the clock is faked, so each rule is read as a state, never as a time.
 */

type Entry = { isIntersecting: boolean; intersectionRatio: number };
let report: (entries: Entry[]) => void = () => {};
let thresholds: number[] = [];

function installObserver() {
  // @ts-expect-error a test-only global
  window.IntersectionObserver = class {
    constructor(cb: typeof report, options?: { threshold?: number | number[] }) {
      report = cb;
      const t = options?.threshold ?? 0;
      thresholds = Array.isArray(t) ? t : [t];
    }
    observe() {}
    disconnect() {}
  };
}

function motionAllowed() {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const state = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-terminal="${id}"]`)!.getAttribute('data-state');

const seen = (ratio: number): Entry[] => [{ isIntersecting: ratio > 0, intersectionRatio: ratio }];

function finishTyping() {
  act(() => {
    vi.advanceTimersByTime(20_000);
  });
}

beforeEach(() => {
  installObserver();
  motionAllowed();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
});

afterEach(() => {
  vi.useRealTimers();
  // @ts-expect-error a test-only global
  delete window.IntersectionObserver;
});

it('watches the Sentinel terminal at a 60% threshold', () => {
  render(<AboutTerminals />);
  expect(thresholds).toContain(0.6);
});

it('streams whoami on load, and leaves Sentinel pending without a scroll', () => {
  const { container } = render(<AboutTerminals />);
  act(() => report(seen(0)));
  expect(state(container, 'whoami')).toBe('typing');
  expect(state(container, 'sentinel')).toBe('pending');
  finishTyping();
  expect(state(container, 'whoami')).toBe('done');
  expect(state(container, 'sentinel')).toBe('pending');
});

it('does not start Sentinel when it comes into view without a user scroll', () => {
  const { container } = render(<AboutTerminals />);
  act(() => report(seen(0)));
  finishTyping();
  act(() => report(seen(0.8)));
  expect(state(container, 'sentinel')).toBe('pending');
});

it('starts Sentinel after a user scroll, once it is 60% in view', () => {
  const { container } = render(<AboutTerminals />);
  act(() => report(seen(0)));
  finishTyping();
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
  act(() => report(seen(0.4)));
  expect(state(container, 'sentinel')).toBe('pending');
  act(() => report(seen(0.65)));
  expect(state(container, 'sentinel')).toBe('typing');
  finishTyping();
  expect(state(container, 'sentinel')).toBe('done');
});

it('already 60% in view at load: starts after whoami finishes, never both at once', () => {
  const { container } = render(<AboutTerminals />);
  act(() => report(seen(0.9)));
  expect(state(container, 'whoami')).toBe('typing');
  expect(state(container, 'sentinel')).toBe('pending');
  finishTyping();
  expect(state(container, 'whoami')).toBe('done');
  // Sentinel took its turn after whoami and has finished too.
  expect(state(container, 'sentinel')).not.toBe('pending');
  finishTyping();
  expect(state(container, 'sentinel')).toBe('done');
});

it('scrolled to while whoami is still typing: waits its turn', () => {
  const { container } = render(<AboutTerminals />);
  act(() => report(seen(0)));
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
  act(() => report(seen(1)));
  expect(state(container, 'whoami')).toBe('typing');
  expect(state(container, 'sentinel')).toBe('pending');
  finishTyping();
  finishTyping();
  expect(state(container, 'sentinel')).toBe('done');
});
