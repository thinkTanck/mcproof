'use client';

import { useEffect, useState } from 'react';
import { useRevealOnView } from './use-reveal';

/**
 * A TERMINAL CARD for /about (owner ruling 2026-10-18; plan decision 3): the
 * Home hero's card frame, with the replay terminal's text, prompt and caret.
 *
 * THE WORDS ARE REAL DOM TEXT FROM THE FIRST BYTE. Two layers share one grid
 * cell: the FINAL layer holds every word and sets the card's height, so the
 * typing can never move the page; the TYPED layer, hidden from assistive
 * technology, draws the command being typed and the output being printed over
 * it. While the card is pending or typing, CSS draws the final layer at
 * opacity 0 (still in the accessibility tree, still indexable); when typing is
 * done, the final layer shows with a blinking caret and the typed layer goes.
 *
 * NO FLASH: the server sends `pending`, which CSS shows as the prompt and the
 * caret only, and under reduced motion or with no script CSS shows the
 * finished text at once, before any script runs. Plays once, when first
 * scrolled into view.
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
    <span aria-hidden="true" style={{ color: 'var(--terminal-prompt)' }}>
      ${' '}
    </span>
  );
}

function Caret() {
  return (
    <span
      aria-hidden="true"
      data-terminal-caret=""
      className="terminal-caret ml-px inline-block h-[1.05em] w-[0.55ch] translate-y-[0.18em]"
      style={{ background: 'var(--text-readout)' }}
    />
  );
}

export function TerminalCard({
  id,
  label,
  command,
  lines,
}: {
  id: string;
  /** The region's accessible name. */
  label: string;
  command: string;
  lines: readonly TerminalLine[];
}) {
  const { ref, reduced, started } = useRevealOnView<HTMLElement>();
  const total = command.length + lines.reduce((n, l) => n + l.text.length, 0);
  const [typed, setTyped] = useState(0);

  // TIME-BASED, not one timer a character: a short tick works out how many
  // characters should be showing from the time since typing began, so a
  // browser that stretches short timers (WebKit does) makes the steps coarser,
  // never the typing later.
  useEffect(() => {
    if (!started || reduced) return;
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
  }, [started, reduced, total, command.length]);

  const state = reduced || typed >= total ? 'done' : started ? 'typing' : 'pending';

  // What the typed layer shows: the command so far, then each line so far.
  const printed = Math.max(0, typed - command.length);
  const starts = lines.map((_, i) =>
    lines.slice(0, i).reduce((n, line) => n + line.text.length, 0),
  );
  const shownLines = lines.map((line, i) =>
    line.text.slice(0, Math.max(0, Math.min(line.text.length, printed - starts[i]!))),
  );
  const commandShown = command.slice(0, Math.min(typed, command.length));
  const lastShown = shownLines.findLastIndex((text) => text.length > 0);

  return (
    <section
      ref={ref}
      role="region"
      aria-label={label}
      data-terminal={id}
      data-state={state}
      data-elev="1"
      className="relative overflow-hidden rounded-xl border border-line px-4 py-3.5 font-mono text-[15px] leading-[1.6]"
      style={{ color: 'var(--text-readout)', overflowWrap: 'anywhere' }}
    >
      <div className="grid">
        <div data-terminal-final="" className="[grid-area:1/1]">
          <p>
            <Prompt />
            {command}
          </p>
          {lines.map((line, i) => (
            <p key={i} className="mt-1 whitespace-pre-wrap">
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
              <p key={i} className="mt-1 whitespace-pre-wrap">
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
