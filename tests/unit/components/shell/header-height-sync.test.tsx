import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEADER_LIVE_VAR, HeaderHeightSync } from '@/components/shell/HeaderHeightSync';

/**
 * The header's measured height reaches the document root, so the pinned run bar
 * and the scroll padding clear the header it actually is (with the text
 * enlarged it grows past `--header-h`). jsdom has no layout and no
 * ResizeObserver, so both are stood in for here; the real engines are measured
 * in tests/e2e/run-bar-clears-header.spec.ts.
 */

class FakeResizeObserver {
  static made: FakeResizeObserver[] = [];
  observed: { el: Element; options?: ResizeObserverOptions }[] = [];
  disconnect = vi.fn();
  constructor(public callback: () => void) {
    FakeResizeObserver.made.push(this);
  }
  observe(el: Element, options?: ResizeObserverOptions) {
    this.observed.push({ el, options });
  }
}

/** What the stubbed layout says the header's height is. */
let headerHeight = 72;
const original = HTMLElement.prototype.getBoundingClientRect;

const live = () => document.documentElement.style.getPropertyValue(HEADER_LIVE_VAR);

const inHeader = () =>
  render(
    <header>
      <HeaderHeightSync />
    </header>,
  );

describe('HeaderHeightSync', () => {
  beforeEach(() => {
    headerHeight = 72;
    FakeResizeObserver.made = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return this.tagName === 'HEADER'
        ? ({ height: headerHeight } as DOMRect)
        : original.call(this);
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    HTMLElement.prototype.getBoundingClientRect = original;
    document.documentElement.style.removeProperty(HEADER_LIVE_VAR);
  });

  it('writes the header height on mount and again whenever the header resizes', () => {
    inHeader();
    expect(live()).toBe('72px');
    const [observer] = FakeResizeObserver.made;
    expect(observer!.observed).toHaveLength(1);
    expect(observer!.observed[0]!.el.tagName).toBe('HEADER');
    expect(observer!.observed[0]!.options).toEqual({ box: 'border-box' });

    headerHeight = 124;
    observer!.callback();
    expect(live()).toBe('124px');
  });

  it('renders nothing visible', () => {
    const { container } = inHeader();
    const marker = container.querySelector('header > span')!;
    expect(marker.hasAttribute('hidden')).toBe(true);
    expect(marker.textContent).toBe('');
  });

  it('clears the variable and stops observing when it unmounts', () => {
    const view = inHeader();
    view.unmount();
    expect(FakeResizeObserver.made[0]!.disconnect).toHaveBeenCalled();
    expect(live()).toBe('');
  });

  it('does nothing where there is no ResizeObserver, so the CSS fallback holds', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    inHeader();
    expect(live()).toBe('');
  });

  it('does nothing outside a header', () => {
    render(<HeaderHeightSync />);
    expect(FakeResizeObserver.made).toHaveLength(0);
    expect(live()).toBe('');
  });
});
