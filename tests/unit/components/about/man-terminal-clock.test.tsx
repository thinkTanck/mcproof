import { act, render } from '@testing-library/react';
import { ManTerminal } from '@/components/about/ManTerminal';
import { ABOUT_SCRIPT, scriptTimeline, shownAt } from '@/lib/about/script';

/**
 * THE /about PLAYBACK TIMING, ON A FAKED CLOCK (owner ruling ABOUT FLAKE 2's
 * fallback, applied for F-A 2026-11-13). The browser test asserts the finished
 * screen only, under reduced motion; every timing claim lives here instead.
 *
 * THE ONE-CLOCK MODEL (owner ruling FLAKE FIX FIRST, 2026-10-21): the terminal
 * shows what the time since playback began says, read from `performance.now`,
 * with every key's moment fixed in advance by the seeded timeline. A frame,
 * the 30 ms interval and the end timer only ask for a redraw. So a late redraw
 * shows the right moment, and a stall is caught up, never stretched.
 *
 * Here `performance.now` is a number the test sets, and the timers are fake,
 * so the two can be moved apart: `at(t)` puts the clock at `t` and lets one
 * frame fire, which is exactly one reading of the clock.
 */

const timeline = scriptTimeline();
let now = 0;

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

beforeEach(() => {
  motionAllowed();
  now = 0;
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
    ],
  });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Mount the terminal; playback begins at clock 0. */
function mount() {
  const { container } = render(<ManTerminal />);
  return container.querySelector<HTMLElement>('[data-terminal]')!;
}

/** Put the clock at `t` (ms since playback began) and let one frame read it. */
function at(t: number) {
  expect(t, 'the clock only moves forward').toBeGreaterThanOrEqual(now);
  now = t;
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

/** The text line `i` of the typed layer shows, or null when it has not started. */
function typed(terminal: HTMLElement, i: number): string | null {
  const line = terminal.querySelector(`[data-terminal-typed] [data-line-index="${i}"]`);
  return line ? (line.querySelector('[data-line-text]')?.textContent ?? '') : null;
}

/** What every line should show at clock `t`, straight from the timeline. */
function expectedAt(t: number): (string | null)[] {
  return ABOUT_SCRIPT.map((line, i) => {
    const count = shownAt(timeline.steps[i]!, line.text.length, t);
    return count < 0 ? null : line.text.slice(0, count);
  });
}

const screenOf = (terminal: HTMLElement) => ABOUT_SCRIPT.map((_, i) => typed(terminal, i));

describe('the timeline', () => {
  it('fixes every key, paragraph and the end in advance, from one seed', () => {
    let at = 250; // the first key waits a short beat
    timeline.steps.forEach((step, i) => {
      expect(step.start, `line ${i} starts where the last ended`).toBe(at);
      if (step.kind === 'command') {
        const keys = step.keyGaps.reduce((sum, gap) => sum + gap, 0);
        expect(step.keyGaps).toHaveLength(ABOUT_SCRIPT[i]!.text.length);
        expect(step.end).toBe(step.start + keys + step.enterPause);
      } else if (step.kind === 'paragraph') {
        expect(step.end).toBe(step.start + ABOUT_SCRIPT[i]!.text.length * step.charMs);
      } else {
        expect(step.end, `${step.kind} line ${i} takes no time`).toBe(step.start);
      }
      at = step.end;
    });
    expect(timeline.total).toBe(at);
    // The whole script plays in 14.3 seconds.
    expect(timeline.total).toBe(14_295);
  });
});

describe('ManTerminal on the one clock', () => {
  it('types each command key at its own precomputed offset, never earlier or later', () => {
    const terminal = mount();
    for (const [i, step] of timeline.steps.entries()) {
      if (step.kind !== 'command') continue;
      const text = ABOUT_SCRIPT[i]!.text;
      at(step.start - 1);
      expect(typed(terminal, i), `command ${i} has not started`).toBeNull();
      at(step.start);
      expect(typed(terminal, i), `command ${i} shows its prompt, no keys yet`).toBe('');
      let offset = 0;
      for (const [k, gap] of step.keyGaps.entries()) {
        offset += gap;
        at(step.start + offset - 1);
        expect(typed(terminal, i), `key ${k + 1} not yet, 1 ms before its offset`).toBe(
          text.slice(0, k),
        );
        at(step.start + offset);
        expect(typed(terminal, i), `key ${k + 1} at its offset ${offset} ms`).toBe(
          text.slice(0, k + 1),
        );
      }
      at(step.end - 1);
      expect(typed(terminal, i), 'the whole command, waiting for Enter').toBe(text);
    }
  });

  it('streams each paragraph at its own rate, one character every charMs', () => {
    const terminal = mount();
    for (const [i, step] of timeline.steps.entries()) {
      if (step.kind !== 'paragraph') continue;
      const text = ABOUT_SCRIPT[i]!.text;
      for (let n = 0; n <= text.length; n += 1) {
        if (n % 9 !== 0 && n !== 1 && n !== text.length) continue;
        at(step.start + n * step.charMs);
        expect(typed(terminal, i), `${n} characters at ${n} x ${step.charMs} ms`).toBe(
          text.slice(0, n),
        );
        if (n < text.length) {
          at(step.start + (n + 1) * step.charMs - 1);
          expect(typed(terminal, i), 'the next one only when its moment comes').toBe(
            text.slice(0, n),
          );
        }
      }
    }
  });

  it('is done exactly when the timeline ends, and shows the whole script then', () => {
    const terminal = mount();
    expect(terminal).toHaveAttribute('data-state', 'typing');
    at(timeline.total - 1);
    expect(terminal).toHaveAttribute('data-state', 'typing');
    at(timeline.total);
    expect(terminal).toHaveAttribute('data-state', 'done');
    expect(screenOf(terminal)).toEqual(ABOUT_SCRIPT.map((line) => line.text));
  });

  it('finishes on the end timer alone when no frame and no interval ever reads the clock', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    vi.spyOn(window, 'setInterval').mockImplementation(
      () => 0 as unknown as ReturnType<typeof setInterval>,
    );
    const terminal = mount();
    now = timeline.total;
    act(() => {
      vi.advanceTimersByTime(timeline.total);
    });
    expect(terminal).toHaveAttribute('data-state', 'done');
  });

  it('catches up after a 2 second frame stall instead of stretching the playback', () => {
    const terminal = mount();
    // Play normally to the middle of the first paragraph, one frame at a time.
    const paragraph = timeline.steps.find((step) => step.kind === 'paragraph')!;
    const before = paragraph.start + 400;
    for (let t = 0; t <= before; t += 16) at(t);
    expect(screenOf(terminal)).toEqual(expectedAt(now));

    // The main thread stalls: the clock runs on 2 s, no frame, interval or timer fires.
    const stalledAt = now;
    let timerTime = now;
    now += 2_000;

    // The first frame after the stall shows where the clock is, not one frame on.
    timerTime += 16;
    at(now + 16);
    expect(screenOf(terminal)).toEqual(expectedAt(now));
    expect(screenOf(terminal)).not.toEqual(expectedAt(stalledAt + 16));

    // And it ends when the clock reaches the end: the stall does not push the
    // finish 2 s later. The timers have run 2 s less than the clock by then.
    while (now + 16 < timeline.total) {
      timerTime += 16;
      at(now + 16);
      expect(terminal).toHaveAttribute('data-state', 'typing');
    }
    timerTime += 16;
    at(timeline.total);
    expect(terminal).toHaveAttribute('data-state', 'done');
    expect(now - timerTime).toBeGreaterThanOrEqual(2_000 - 16);
  });
});
