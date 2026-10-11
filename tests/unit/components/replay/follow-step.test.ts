import { followStepInside, nextScrollTop } from '@/components/replay/follow-step';

/**
 * FOLLOW THE CURRENT STEP INSIDE THE TERMINAL (Part D, the phone replay).
 *
 * On a phone the terminal is a capped box that scrolls inside itself. As the
 * playhead moves, the box scrolls the least it can to show the whole current
 * line, the way a console keeps its newest line at the bottom: down when the
 * line is below the visible part, up when it is above (scrubbing back), and not
 * at all when it is already in view. It computes the box's own scrollTop and
 * nothing else, so the page never moves.
 *
 * Coordinates are in the box's content: 0 is the top of its scrollable content.
 */
const box = (scrollTop: number) => ({
  scrollTop,
  clientHeight: 200,
  paddingTop: 12,
  paddingBottom: 12,
});

describe('nextScrollTop', () => {
  it('does not scroll when the whole line is already in view', () => {
    expect(nextScrollTop(box(0), { top: 40, bottom: 64 })).toBeNull();
    expect(nextScrollTop(box(100), { top: 150, bottom: 280 })).toBeNull();
  });

  it('scrolls down just far enough to show the line, clear of the bottom padding', () => {
    // Bottom of view is 0 + 200; the line ends at 260, plus 12 of padding.
    expect(nextScrollTop(box(0), { top: 236, bottom: 260 })).toBe(72);
  });

  it('scrolls up to a line above the view (scrubbing back), clear of the top padding', () => {
    expect(nextScrollTop(box(300), { top: 112, bottom: 136 })).toBe(100);
  });

  it('shows the start of a line taller than the view', () => {
    expect(nextScrollTop(box(0), { top: 400, bottom: 700 })).toBe(388);
  });

  it('never asks for a negative scroll', () => {
    expect(nextScrollTop(box(50), { top: 4, bottom: 28 })).toBe(0);
  });
});

describe('followStepInside', () => {
  function setup(lineTop: number) {
    const box = document.createElement('div');
    const line = document.createElement('div');
    box.style.paddingTop = '12px';
    box.style.paddingBottom = '12px';
    Object.defineProperty(box, 'clientHeight', { value: 200 });
    box.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    line.getBoundingClientRect = () => ({ top: lineTop, height: 24 }) as DOMRect;
    const scrollTo = vi.fn();
    box.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    return { box, line, scrollTo };
  }

  it('scrolls only the box, smoothly when motion is allowed', () => {
    const { box, line, scrollTo } = setup(336);
    followStepInside(box, line, true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 72, behavior: 'smooth' });
  });

  it('jumps without smoothing when motion is reduced', () => {
    const { box, line, scrollTo } = setup(336);
    followStepInside(box, line, false);
    expect(scrollTo).toHaveBeenCalledWith({ top: 72, behavior: 'auto' });
  });

  it('judges from where a smooth scroll is going: scrub to the end and straight back', () => {
    const { box, line, scrollTo } = setup(336);
    followStepInside(box, line, true);
    // The first scroll has not moved the box yet (scrollTop is still 0), so the
    // first line looks in view from here. From where the box is going, it is not.
    const first = document.createElement('div');
    first.getBoundingClientRect = () => ({ top: 112, height: 24 }) as DOMRect;
    followStepInside(box, first, true);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('leaves the box alone when the line is already in view', () => {
    const { box, line, scrollTo } = setup(140);
    followStepInside(box, line, true);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
