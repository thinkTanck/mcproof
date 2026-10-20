'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  TERMINAL_BG,
  TERMINAL_CARET_CLASS,
  TERMINAL_ELEV,
  TERMINAL_PROMPT_COLOR,
  TERMINAL_READOUT_COLOR,
  TERMINAL_TEXT_CLASS,
} from '@/components/replay/terminal-style';
import { ABOUT_PROMPT } from '@/lib/about/copy';
import { ABOUT_SCRIPT, scriptTimeline, shownAt, type ScriptLine } from '@/lib/about/script';
import { usePrefersReducedMotionAfterMount } from './use-reveal';

/**
 * THE /about TERMINAL (owner ruling ABOUT FINAL, 2026-10-20): one session in
 * the replay terminal's look, `man sentinel` then `whoami`, played on page
 * load from `ABOUT_SCRIPT` (`src/lib/about/script.ts` holds the timing).
 *
 * THE WORDS ARE REAL DOM TEXT FROM THE FIRST BYTE. Two layers share one grid
 * cell: the FINAL layer holds every line and sets the box's height, so the
 * playback can never move the page; the TYPED layer, hidden from assistive
 * technology, is what a reader sees. While motion is allowed and script runs,
 * the final layer stays at opacity 0 for good: switched on after typing, it
 * became a late largest paint (CWV · about, LCP 6.35s). Under reduced motion
 * or with no script, CSS shows the final layer at once and hides the typed
 * one, before any script runs.
 *
 * Playback is time-based: a short tick works out what should be showing from
 * the time since it began, so a browser that stretches short timers (WebKit)
 * makes the steps coarser, never the playback later.
 */
const TICK_MS = 30;

const noSubscription = () => () => {};
/** False in the server render, true once mounted: playback starts on the client, never in the HTML. */
const useMounted = () =>
  useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

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

/** A real man page indents by seven; a phone closes that up to two. */
const INDENT = 'pl-[7ch] max-sm:pl-[2ch]';

/** One line, with as much of its text as is showing. */
function Line({
  line,
  text,
  caret,
  index,
}: {
  line: ScriptLine;
  text: string;
  caret: boolean;
  index?: number;
}) {
  const indexAttr = index === undefined ? {} : { 'data-line-index': index };
  if (line.kind === 'short' && line.parts) {
    // The man header: three parts held apart on a desk; on a phone the manual
    // title drops to a row of its own, centred, so nothing reaches sideways.
    return (
      <p
        data-line="man-header"
        {...indexAttr}
        className="flex flex-wrap justify-between gap-x-[1ch]"
      >
        <span data-line-text="" className="contents">
          <span>{line.parts[0]}</span>{' '}
          <span className="max-sm:order-last max-sm:basis-full max-sm:text-center">
            {line.parts[1]}
          </span>{' '}
          <span>{line.parts[2]}</span>
        </span>
      </p>
    );
  }
  const indent = 'indent' in line && line.indent ? INDENT : '';
  const showPrompt = line.kind === 'command' || line.kind === 'prompt';
  return (
    <p
      data-line={line.kind}
      {...indexAttr}
      className={`min-h-[1.6em] whitespace-pre-wrap ${indent}`}
    >
      {showPrompt ? <Prompt /> : null}
      <span data-line-text="">{text}</span>
      {caret ? <Caret /> : null}
    </p>
  );
}

export function ManTerminal() {
  const mounted = useMounted();
  const reduced = usePrefersReducedMotionAfterMount();
  const timeline = useMemo(() => scriptTimeline(), []);
  const [elapsed, setElapsed] = useState(-1);

  useEffect(() => {
    if (!mounted || reduced) return;
    const begun = performance.now();
    const tick = setInterval(() => {
      const t = performance.now() - begun;
      setElapsed(t);
      if (t >= timeline.total) clearInterval(tick);
    }, TICK_MS);
    return () => clearInterval(tick);
  }, [mounted, reduced, timeline.total]);

  const done = reduced || elapsed >= timeline.total;
  const state = done ? 'done' : mounted ? 'typing' : 'pending';
  const t = done ? timeline.total : Math.max(0, elapsed);

  // What the typed layer shows: every line that has started, as far as it has got.
  const shown = ABOUT_SCRIPT.map((line, i) => ({
    line,
    index: i,
    count: shownAt(timeline.steps[i]!, line.text.length, t),
  })).filter((entry) => entry.count >= 0);
  const last = shown.length - 1;

  return (
    <section
      role="region"
      aria-label="Terminal: man sentinel, whoami"
      data-terminal="about"
      data-state={state}
      data-elev={TERMINAL_ELEV}
      className={`relative ${TERMINAL_TEXT_CLASS}`}
      style={{ background: TERMINAL_BG, color: TERMINAL_READOUT_COLOR, overflowWrap: 'anywhere' }}
    >
      <div className="grid">
        <div data-terminal-final="" className="[grid-area:1/1]">
          {ABOUT_SCRIPT.map((line, i) => (
            <Line key={i} line={line} text={line.text} caret={line.kind === 'prompt'} />
          ))}
        </div>
        <div data-terminal-typed="" aria-hidden="true" className="[grid-area:1/1]">
          {state === 'pending'
            ? null
            : shown.map(({ line, index, count }, n) => (
                <Line
                  key={index}
                  line={line}
                  index={index}
                  text={line.text.slice(0, count)}
                  caret={n === last && line.kind !== 'blank'}
                />
              ))}
        </div>
      </div>
    </section>
  );
}
