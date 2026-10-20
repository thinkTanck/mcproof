'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TERMINAL_BG,
  TERMINAL_CARET_CLASS,
  TERMINAL_ELEV,
  TERMINAL_PROMPT_COLOR,
  TERMINAL_READOUT_COLOR,
  TERMINAL_TEXT_CLASS,
} from '@/components/replay/terminal-style';
import { ABOUT_PROMPT } from '@/lib/about/copy';
import { usePrefersReducedMotionAfterMount } from './use-reveal';

/**
 * A TERMINAL CARD for /about, in the replay terminal's look (owner ruling
 * ABOUT REVISION, 2026-10-19): the same box, background, amber prompt, cyan
 * readout and block caret, from `terminal-style.ts`.
 *
 * THE WORDS ARE REAL DOM TEXT FROM THE FIRST BYTE. Two layers share one grid
 * cell: the FINAL layer holds every word and sets the card's height, so the
 * typing can never move the page; the TYPED layer, hidden from assistive
 * technology, is what a reader sees, from the prompt to the last character.
 * While motion is allowed and script runs, the final layer stays at opacity 0
 * for good: switched on after typing, it became a late largest paint
 * (CWV · about, LCP 6.35s). Under reduced motion or with no script, CSS shows
 * the final layer at once and hides the typed one, before any script runs.
 *
 * CONTROLLED: it types only once `start` is true, and calls `onDone` when it
 * has finished, so the page can run two terminals in turn (`AboutTerminals`).
 * Typing is time-based: a short tick works out how many characters should be
 * showing from the time since it began, so a browser that stretches short
 * timers (WebKit) makes the steps coarser, never the typing later.
 */
export interface TerminalLine {
  readonly kind: 'out';
  readonly text: string;
}

const COMMAND_MS = 70;
const OUTPUT_MS = 6;
const TICK_MS = 30;

function Prompt() {
  return (
    <span aria-hidden="true" data-terminal-prompt="" style={{ color: TERMINAL_PROMPT_COLOR }}>
      {ABOUT_PROMPT}{' '}
    </span>
  );
}

function Caret() {
  return (
    <span
      aria-hidden="true"
      data-terminal-caret=""
      className={`terminal-caret ${TERMINAL_CARET_CLASS}`}
      style={{ background: TERMINAL_READOUT_COLOR }}
    />
  );
}

export function TerminalCard({
  id,
  label,
  command,
  lines,
  start,
  onDone,
}: {
  id: string;
  /** The region's accessible name. */
  label: string;
  command: string;
  lines: readonly TerminalLine[];
  /** Begin typing. Until then the card waits, pending. */
  start: boolean;
  /** Called once, when the last character is showing. */
  onDone?: () => void;
}) {
  const reduced = usePrefersReducedMotionAfterMount();
  const total = command.length + lines.reduce((n, l) => n + l.text.length, 0);
  const [typed, setTyped] = useState(0);
  const doneCalled = useRef(false);

  useEffect(() => {
    if (!start || reduced) return;
    const begun = performance.now();
    const commandTime = command.length * COMMAND_MS;
    const tick = setInterval(() => {
      const elapsed = performance.now() - begun;
      const shown =
        elapsed < commandTime
          ? Math.floor(elapsed / COMMAND_MS)
          : command.length + Math.floor((elapsed - commandTime) / OUTPUT_MS);
      setTyped(Math.min(total, shown));
      if (shown >= total) clearInterval(tick);
    }, TICK_MS);
    return () => clearInterval(tick);
  }, [start, reduced, total, command.length]);

  const done = reduced || typed >= total;
  useEffect(() => {
    if (done && !doneCalled.current) {
      doneCalled.current = true;
      onDone?.();
    }
  }, [done, onDone]);

  const state = done ? 'done' : start ? 'typing' : 'pending';

  // What the typed layer shows: the command so far, then each line so far.
  const printed = Math.max(0, typed - command.length);
  const starts = lines.map((_, i) =>
    lines.slice(0, i).reduce((n, line) => n + line.text.length, 0),
  );
  const shownLines = done
    ? lines.map((line) => line.text)
    : lines.map((line, i) =>
        line.text.slice(0, Math.max(0, Math.min(line.text.length, printed - starts[i]!))),
      );
  const commandShown = done ? command : command.slice(0, Math.min(typed, command.length));
  const lastShown = shownLines.findLastIndex((text) => text.length > 0);

  return (
    <section
      role="region"
      aria-label={label}
      data-terminal={id}
      data-state={state}
      data-elev={TERMINAL_ELEV}
      className={`relative ${TERMINAL_TEXT_CLASS}`}
      style={{ background: TERMINAL_BG, color: TERMINAL_READOUT_COLOR, overflowWrap: 'anywhere' }}
    >
      <div className="grid">
        <div data-terminal-final="" className="[grid-area:1/1]">
          <p>
            <Prompt />
            {command}
          </p>
          {lines.map((line, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {line.text}
              {i === lines.length - 1 ? <Caret /> : null}
            </p>
          ))}
        </div>
        <div data-terminal-typed="" aria-hidden="true" className="[grid-area:1/1]">
          <p>
            <Prompt />
            {commandShown}
            {lastShown < 0 ? <Caret /> : null}
          </p>
          {shownLines.map((text, i) =>
            text.length > 0 ? (
              <p key={i} className="whitespace-pre-wrap">
                {text}
                {i === lastShown ? <Caret /> : null}
              </p>
            ) : null,
          )}
        </div>
      </div>
    </section>
  );
}
