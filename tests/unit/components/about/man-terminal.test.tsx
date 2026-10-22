import { act, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { ManTerminal } from '@/components/about/ManTerminal';
import { ABOUT_SCRIPT, scriptTimeline, shownAt } from '@/lib/about/script';

/**
 * THE /about TERMINAL PLAYS LIKE A REAL SHELL, EXCEPT PARAGRAPHS (owner ruling
 * ABOUT FINAL, 2026-10-20):
 *
 *  - commands type a key at a time, about 60 to 120 ms a key, then a 300 to
 *    500 ms pause as if Enter was pressed;
 *  - short lines (the man header, NAME, the NAME line, DESCRIPTION, the name)
 *    print whole, at once;
 *  - paragraphs stream at about 15 to 25 ms a character;
 *  - a blank line, then a fresh prompt with the caret;
 *  - reduced motion or no script: the final screen at once.
 *
 * Read on a faked clock, as what is on screen at each moment, never as a time
 * asserted against the browser.
 */

function motion(reduce: boolean) {
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

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

afterEach(() => {
  vi.useRealTimers();
});

describe('the script', () => {
  it('keys commands at 60 to 120 ms with an Enter pause of 300 to 500 ms, and streams paragraphs at 15 to 25 ms', () => {
    const timeline = scriptTimeline();
    for (const step of timeline.steps) {
      if (step.kind === 'command') {
        for (const gap of step.keyGaps) {
          expect(gap).toBeGreaterThanOrEqual(60);
          expect(gap).toBeLessThanOrEqual(120);
        }
        expect(step.enterPause).toBeGreaterThanOrEqual(300);
        expect(step.enterPause).toBeLessThanOrEqual(500);
        // Slight variation: not every key the same.
        expect(new Set(step.keyGaps).size).toBeGreaterThan(1);
      }
      if (step.kind === 'paragraph') {
        expect(step.charMs).toBeGreaterThanOrEqual(15);
        expect(step.charMs).toBeLessThanOrEqual(25);
      }
    }
    // The same every time: a fixed seed, so the server, the browser and the
    // tests agree on what the screen shows at each moment.
    expect(scriptTimeline()).toEqual(timeline);
  });

  it('is two commands, a man page, the name, the bio and a fresh prompt', () => {
    expect(ABOUT_SCRIPT.map((line) => line.kind)).toEqual([
      'command',
      'short',
      'blank',
      'short',
      'short',
      'blank',
      'short',
      'paragraph',
      'blank',
      'command',
      'short',
      'paragraph',
      'blank',
      'prompt',
    ]);
  });
});

describe('ManTerminal', () => {
  it('sends the whole final screen, pending, from the server', () => {
    const html = renderToString(<ManTerminal />);
    expect(html).toContain('data-state="pending"');
    expect(html).toContain('SENTINEL(7)');
    expect(html).toContain('Dameion Ayers');
  });

  it('lands on the finished screen at once under reduced motion', () => {
    motion(true);
    const { container } = render(<ManTerminal />);
    expect(container.querySelector('[data-terminal]')).toHaveAttribute('data-state', 'done');
  });

  it('plays on load: short lines whole, commands and paragraphs built up, the final text always there', () => {
    motion(false);
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
    const { container } = render(<ManTerminal />);
    const terminal = container.querySelector('[data-terminal]')!;
    const full = new Map(ABOUT_SCRIPT.map((line, i) => [String(i), line]));
    const finalWords = () =>
      [...terminal.querySelectorAll('[data-terminal-final] [data-line]')].map((el) =>
        norm(el.textContent),
      );
    const before = finalWords();
    let sawPartialCommand = false;
    let sawPartialParagraph = false;
    expect(terminal).toHaveAttribute('data-state', 'typing');
    for (let i = 0; i < 500 && terminal.getAttribute('data-state') !== 'done'; i += 1) {
      act(() => {
        vi.advanceTimersByTime(80);
      });
      for (const el of terminal.querySelectorAll<HTMLElement>(
        '[data-terminal-typed] [data-line-index]',
      )) {
        const line = full.get(el.dataset.lineIndex!)!;
        const shown = norm(el.querySelector('[data-line-text]')?.textContent ?? '');
        const want = norm(line.text);
        if (line.kind === 'short') expect(shown, 'a short line prints whole').toBe(want);
        else expect(want.startsWith(shown), `${line.kind} builds up from its start`).toBe(true);
        if (line.kind === 'command' && shown.length > 0 && shown.length < want.length) {
          sawPartialCommand = true;
        }
        if (line.kind === 'paragraph' && shown.length > 0 && shown.length < want.length) {
          sawPartialParagraph = true;
        }
      }
      // The words a reader and a crawler get never change.
      expect(finalWords()).toEqual(before);
    }
    expect(terminal).toHaveAttribute('data-state', 'done');
    expect(sawPartialCommand, 'a command was seen part typed').toBe(true);
    expect(sawPartialParagraph, 'a paragraph was seen part streamed').toBe(true);
    // The end: a fresh prompt with the caret after it.
    const typed = [...terminal.querySelectorAll('[data-terminal-typed] [data-line-index]')];
    const last = typed[typed.length - 1]!;
    expect(norm(last.textContent)).toBe('visitor@mcproof:~$');
    expect(last.querySelector('[data-terminal-caret]')).not.toBeNull();
  }, 15_000); // under 2 s alone, more on a loaded machine, so it gets room of its own. // It renders the whole 14 s playback, about 480 ticks, on a faked clock:
});

/**
 * ONE CLOCK (owner ruling FLAKE FIX FIRST, 2026-10-21). The screen is worked
 * out from the time since playback began, read from one start, so a browser
 * that delivers frames late (WebKit on a loaded CI runner left /about typing
 * at 25 s on a 14.3 s script) catches up instead of stretching, and the
 * finished state does not wait on frames at all.
 */
describe('ManTerminal, driven by one clock', () => {
  let frames: FrameRequestCallback[] = [];
  let now = 0;

  beforeEach(() => {
    motion(false);
    frames = [];
    now = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Deliver the one frame waiting, as a browser would after a stall. */
  const oneFrame = () =>
    act(() => {
      const waiting = frames;
      frames = [];
      for (const cb of waiting) cb(now);
    });

  it('catches up in one late frame: what shows is what the clock says, not what the frames counted', () => {
    const { container } = render(<ManTerminal />);
    const terminal = container.querySelector('[data-terminal]')!;
    const { steps } = scriptTimeline();
    // The bio paragraph's start, plus half a second: some of it, never all.
    const bio = ABOUT_SCRIPT.length - 3;
    now = steps[bio]!.start + 500;
    oneFrame();
    expect(terminal).toHaveAttribute('data-state', 'typing');
    const lines = [
      ...terminal.querySelectorAll<HTMLElement>('[data-terminal-typed] [data-line-index]'),
    ];
    // Every earlier line is already whole, in one frame.
    expect(lines.length).toBe(bio + 1);
    const shown = lines.at(-1)!.querySelector('[data-line-text]')!.textContent!;
    expect(shown.length).toBe(shownAt(steps[bio]!, ABOUT_SCRIPT[bio]!.text.length, now - 0));
  });

  it('finishes on time with no frame at all', () => {
    const { container } = render(<ManTerminal />);
    const terminal = container.querySelector('[data-terminal]')!;
    const { total } = scriptTimeline();
    now = total + 1;
    act(() => {
      vi.advanceTimersByTime(total + 1);
    });
    expect(terminal).toHaveAttribute('data-state', 'done');
  });

  it('catches up at once when the page is shown again', () => {
    const { container } = render(<ManTerminal />);
    const terminal = container.querySelector('[data-terminal]')!;
    now = scriptTimeline().total + 5000;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(terminal).toHaveAttribute('data-state', 'done');
  });
});
