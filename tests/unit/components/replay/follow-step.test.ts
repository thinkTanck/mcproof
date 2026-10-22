import {
  atFollowBottom,
  atLiveEdge,
  followStepInside,
  mayResume,
  nextFollow,
  nextScrollTop,
} from '@/components/replay/follow-step';

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

/**
 * FOLLOW ONLY FROM THE LIVE EDGE (owner ruling REPLAY SCROLL, 2026-10-20). The
 * terminal follows the playhead while the viewer is at its bottom. A viewer
 * who scrolls up inside it is reading back, and is left there until they
 * scroll down to the bottom again. The bottom is where the current line is in
 * view, or the box's own end.
 */
describe('atLiveEdge', () => {
  const view = (scrollTop: number) => ({ scrollTop, clientHeight: 200, scrollHeight: 800 });

  it('is at the edge when the current line ends inside the view', () => {
    expect(atLiveEdge(view(300), { top: 440, bottom: 480 })).toBe(true);
  });

  it('is at the edge at the box end, whatever the line', () => {
    expect(atLiveEdge(view(600), { top: 10, bottom: 50 })).toBe(true);
  });

  it('is not at the edge when the current line is below the view', () => {
    expect(atLiveEdge(view(100), { top: 440, bottom: 480 })).toBe(false);
  });

  it('allows a pixel or two of rounding', () => {
    expect(atLiveEdge(view(279), { top: 440, bottom: 480 })).toBe(true);
  });
});

/**
 * WHEN TO FOLLOW (owner rulings FLAKE FIX FIRST and FLAKE FIX 2, 2026-10-21).
 *
 *  - Any viewer input on the terminal (a wheel, a touch, a press on its
 *    scrollbar, a scroll key) stops the follow at once.
 *  - An UPWARD key or wheel marks the viewer as moved away at once, before
 *    any scroll lands; so does any scroll the follow did not make that moves
 *    away from the bottom. Only a downward input, or a scroll down that
 *    reaches the bottom, clears it.
 *  - The follow resumes only when the viewer has not moved away and the box
 *    has been still at the bottom for 800 ms after their last input.
 *
 * The bottom is where the follow last held the box, or the box's own end.
 */
describe('nextFollow', () => {
  const on = { following: true, movedAway: false };

  it('stops on any viewer input, at once', () => {
    for (const toward of ['up', 'down', 'none'] as const) {
      expect(nextFollow(on, { kind: 'input', toward }).following).toBe(false);
    }
  });

  it('marks an upward key or wheel as moved away at once, before any scroll lands', () => {
    expect(nextFollow(on, { kind: 'input', toward: 'up' })).toEqual({
      following: false,
      movedAway: true,
    });
  });

  it('clears moved-away on a downward input', () => {
    const away = nextFollow(on, { kind: 'input', toward: 'up' });
    expect(nextFollow(away, { kind: 'input', toward: 'down' }).movedAway).toBe(false);
  });

  it('marks any scroll it did not make that moves away from the bottom', () => {
    expect(
      nextFollow(on, { kind: 'scroll', from: 300, to: 280, atBottom: false, ours: false }),
    ).toEqual({ following: false, movedAway: true });
    // Its own smooth follow never stops it.
    expect(
      nextFollow(on, { kind: 'scroll', from: 280, to: 300, atBottom: false, ours: true }),
    ).toEqual(on);
  });

  it('clears moved-away on a scroll down that reaches the bottom, and resumes nothing by itself', () => {
    const away = { following: false, movedAway: true };
    expect(
      nextFollow(away, { kind: 'scroll', from: 100, to: 200, atBottom: false, ours: false }),
    ).toEqual(away);
    expect(
      nextFollow(away, { kind: 'scroll', from: 200, to: 400, atBottom: true, ours: false }),
    ).toEqual({ following: false, movedAway: false });
  });

  it('ignores a pixel of rounding', () => {
    expect(
      nextFollow(on, { kind: 'scroll', from: 300, to: 299, atBottom: false, ours: false }),
    ).toEqual(on);
  });
});

describe('mayResume', () => {
  const still = { atBottom: true, sinceInput: 800, sinceScroll: 800 };

  it('resumes once the box has been still at the bottom for 800 ms after the last input', () => {
    expect(mayResume({ following: false, movedAway: false }, still)).toBe(true);
  });

  it('waits out the 800 ms after an input or a scroll', () => {
    expect(mayResume({ following: false, movedAway: false }, { ...still, sinceInput: 799 })).toBe(
      false,
    );
    expect(mayResume({ following: false, movedAway: false }, { ...still, sinceScroll: 799 })).toBe(
      false,
    );
  });

  it('never resumes away from the bottom', () => {
    expect(mayResume({ following: false, movedAway: false }, { ...still, atBottom: false })).toBe(
      false,
    );
  });

  it('key up before the late scroll: an upward key keeps it paused though the box has not moved yet', () => {
    // PageUp pressed and let go while the box is still at the bottom; the
    // engine applies the scroll later (desktop WebKit, about 400 ms).
    const afterKey = nextFollow(
      { following: true, movedAway: false },
      { kind: 'input', toward: 'up' },
    );
    expect(mayResume(afterKey, still)).toBe(false);
    const late = nextFollow(afterKey, {
      kind: 'scroll',
      from: 300,
      to: 120,
      atBottom: false,
      ours: false,
    });
    expect(mayResume(late, { ...still, atBottom: false })).toBe(false);
  });
});

describe('atFollowBottom', () => {
  const view = { scrollTop: 200, clientHeight: 200, scrollHeight: 800 };

  it('is at the bottom where the follow last held the box, or lower', () => {
    expect(atFollowBottom(view, 200)).toBe(true);
    expect(atFollowBottom(view, 202)).toBe(true);
    expect(atFollowBottom(view, 230)).toBe(false);
  });

  it('is at the bottom at the box end, whatever the follow did', () => {
    expect(atFollowBottom({ ...view, scrollTop: 600 }, 900)).toBe(true);
  });
});
