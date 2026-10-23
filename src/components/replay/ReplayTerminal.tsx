'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { usePrefersReducedMotion } from '@/lib/hud/reduced-motion';
import { cn } from '@/lib/utils';
import { BandShape } from '@/components/leaderboard/BandShape';
import { stepMeta } from './step-meta';
import { REPLAY_KEY_ID } from './ReplayKey';
import {
  RESUME_AFTER_MS,
  atFollowBottom,
  cancelFollow,
  followStepInside,
  isOurScroll,
  mayResume,
  nextFollow,
  type FollowEvent,
  type FollowState,
} from './follow-step';
import { useReplayLayout } from './phone-layout';
import { PrintedHandle, SpeakerHandle } from './SpeakerHandle';
import { OPERATOR_HANDLE, agentHandle, handleForStep } from '@/lib/replay/roles';
import type { Step } from '@/contract';
import { TERMINAL_BG, TERMINAL_CARET_CLASS, TERMINAL_TEXT_CLASS } from './terminal-style';
import { SESSION_ENDED, isInferredSessionEnd } from '@/lib/replay/session-end';

/**
 * The live agent-transcript terminal — the replay hero. It reads like a real
 * shell session: every step is a line under a bash-style host prompt
 * (model@sentinel:~/runs$), tool calls render as commands with --flag args, and
 * tool results / memory reads render as plain output lines. Text is one colour;
 * only the compromise line is breach-red. Lines stream in one at a time as the
 * playhead advances, the newest line held around the vertical middle (never past
 * it), and once the run completes the whole session scrolls to review.
 *
 * The transcript is borderless and chromeless by design (no window title, no
 * frame) so it reads as a bare console, distinguished from the page only by its
 * darker screen.
 *
 * Parity with the timeline it replaces: EVERY step is a labelled <button> in the
 * <ol>, so clicking a reached line scrubs and the replay tests + a11y contract
 * hold. A step the playhead has not reached is not drawn, and is handled in two
 * halves that go together:
 *
 *   - `sr-only` on its row: hidden from sight, still in the accessibility tree,
 *     so a screen reader reads all the steps and can activate any of them to jump
 *     there;
 *   - `tabIndex={-1}` on its button: out of the tab order. Without it a sighted
 *     keyboard user tabbed onto a one-pixel element with nothing on screen to
 *     show where focus was, once for every step still ahead (WCAG 2.4.7).
 *
 * So a step button is a tab stop exactly when its step is drawn (`i <= current`).
 * Assistive technology does not need a tab stop to activate a control, and
 * everyone has the scrubber and the previous / next controls in the transport.
 * The typed length derives from the playhead position (a magnitude); the text is
 * the trace verbatim. Under prefers-reduced-motion the active line is complete at
 * once.
 *
 * ON A PHONE (Part D) the terminal is as tall as the WHOLE transcript, up to the
 * cap its box in Replay sets, with no bottom room. The lines still ahead are not
 * drawn, so a hidden, aria-hidden copy of every line (its text drawn by CSS from
 * an attribute, so nothing finds it twice) holds that height from the start:
 * playback never grows the terminal and never moves the controls under it. The
 * terminal then follows the current step by scrolling only itself, the least it
 * can (see follow-step.ts), smooth unless motion is reduced.
 *
 * EACH PROMPT OPENS ITS DEFINITION (Batch G, 2026-10-13). A row that is typed
 * under a prompt (`user@console`, `target-agent@sentinel`) has a second
 * control, `SpeakerHandle`, laid over the handle at the start of the row. It is
 * a SIBLING of the row's button, never inside it, and it is a native
 * disclosure and not a `<button>`: the steps stay the list's buttons, all of
 * them and nothing else. The handle's text is still printed by the row's
 * button, where it always was, so no line moved; the row's button is what it
 * was, text and all. Pressing the handle does not select the step. The handle
 * is not a Tab stop (one stop a step, as before): Left from a step moves to
 * its handle and Right moves back, and the same definitions are in the legend
 * above the terminal. A row the playhead has not reached draws no handle.
 */

function compact(v: unknown): string {
  let s: string;
  if (typeof v === 'string') s = v;
  else {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 220 ? `${s.slice(0, 219)}…` : s;
}

function flags(args: unknown): string {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return Object.entries(args as Record<string, unknown>)
      .map(([k, v]) => `--${k}=${typeof v === 'string' ? `"${v}"` : compact(v)}`)
      .join(' ');
  }
  return compact(args);
}

/**
 * One shell line per step, in one of three classes so input, action and output
 * are never conflated:
 *   'input' — the human operator's request (a `user@console` prompt)
 *   'cmd'   — a command the agent runs in its own shell (the agent prompt)
 *   'out'   — output the agent produces or receives (indented, marked): its
 *             reasoning (`agent ▸`), tool results / memory reads (`⇒`)
 * Every line carries a `marker` prompt (soft yellow) + the payload `text` (cyan);
 * for 'cmd'/'input' the marker is the host prompt, filled in at render.
 */
function lineFor(step: Step): { kind: 'input' | 'cmd' | 'out'; marker?: string; text: string } {
  switch (step.type) {
    case 'principal_instruction':
      return { kind: 'input', text: step.content };
    case 'agent_reasoning':
      return { kind: 'out', marker: 'agent ▸', text: step.content };
    case 'tool_call':
      return { kind: 'cmd', text: `${step.tool} ${flags(step.args)}`.trim() };
    case 'tool_result':
      return { kind: 'out', marker: '⇒', text: compact(step.result) };
    case 'memory_read':
      return { kind: 'out', marker: '⇒', text: `[mem] ${step.key} = ${compact(step.value)}` };
    case 'memory_write':
      return {
        kind: 'cmd',
        text: `mem-write ${step.key}=${typeof step.value === 'string' ? `"${step.value}"` : compact(step.value)}`,
      };
    case 'task_complete':
      // The recorder's inferred end marker prints the owner's sentence; the
      // step card carries the note (LAUNCH POLISH, 5a).
      return {
        kind: 'cmd',
        text: `exit 0  # ${isInferredSessionEnd(step.summary) ? SESSION_ENDED : (step.summary ?? 'run complete')}`,
      };
  }
}

export function ReplayTerminal({
  steps,
  current,
  compromiseIndex,
  model,
  onSelect,
}: {
  steps: Step[];
  current: number;
  compromiseIndex: number;
  model: string;
  onSelect: (index: number) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const lines = useMemo(() => steps.map(lineFor), [steps]);
  const [typed, setTyped] = useState<{ i: number; n: number }>({ i: -1, n: 0 });
  const activeRef = useRef<HTMLLIElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const layout = useReplayLayout();
  const agentAt = agentHandle(model);
  const userPrompt = `${OPERATOR_HANDLE}:~`;
  const agentPrompt = `${agentAt}:~`;

  // Left from a step goes to the handle at the start of its row, Right goes
  // back. The handle is not a Tab stop, so this is how the keyboard reaches it
  // from the transcript.
  const onRowKey = (event: KeyboardEvent<HTMLOListElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const from = event.target as HTMLElement;
    const row = from.closest('li');
    if (!row) return;
    const to =
      event.key === 'ArrowLeft' && from.matches('button')
        ? row.querySelector<HTMLElement>('summary')
        : event.key === 'ArrowRight' && from.matches('summary')
          ? row.querySelector<HTMLElement>(':scope > button')
          : null;
    if (!to) return;
    event.preventDefault();
    to.focus({ preventScroll: true });
  };

  // Typewriter for the active line. setState runs only inside rAF callbacks, so
  // this never trips react-hooks/set-state-in-effect.
  useEffect(() => {
    const full = lines[current]?.text.length ?? 0;
    if (reduced) {
      const raf = requestAnimationFrame(() => setTyped({ i: current, n: full }));
      return () => cancelAnimationFrame(raf);
    }
    let raf = 0;
    const t0 = performance.now();
    const cps = 280; // characters per second
    const tick = (t: number) => {
      const n = Math.min(full, Math.round(((t - t0) / 1000) * cps));
      setTyped({ i: current, n });
      if (n < full) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [current, reduced, lines]);

  // FOLLOW THE STEP INSIDE THE TERMINAL, NEVER THE PAGE, AT EVERY WIDTH
  // (owner ruling REPLAY SCROLL, 2026-10-20). The desktop branch used to call
  // scrollIntoView({ block: 'center' }), which scrolls the page as well, so a
  // viewer who had scrolled down to the step card and the controls was pulled
  // back up on every step. The line is measured on a phone on the reserve copy
  // of its line, which has its full height before it is typed, and elsewhere
  // on the row itself, followed again each time it grows.
  //
  // ONLY FROM THE BOTTOM (owner rulings FLAKE FIX FIRST and FLAKE FIX 2,
  // 2026-10-21, fixing #250). The viewer's own input on the terminal stops the
  // follow at once, even mid-way through a smooth follow, which is cancelled
  // where it is: a wheel, a touch, a press on the scrollbar, a scroll key. An
  // upward key or wheel marks them as moved away at once, before its scroll
  // lands, and so does any scroll the follow did not make that moves away from
  // the bottom (`nextFollow`). It resumes only once the box has been still at
  // the bottom for 800 ms after their last input (`mayResume`), the bottom
  // being where the follow last held it (`followAt`) or the box's own end.
  // RESET follows again. #250 counted only scrolls, so a wheel that landed
  // during a smooth follow was not seen; and letting go of PageUp before
  // WebKit applied its scroll read as never having left, until 2026-10-21.
  const follow = useRef<FollowState>({ following: true, movedAway: false });
  const followAt = useRef(0);
  const followNow = useRef<() => void>(() => {});
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  const currentLine = (): Element | null =>
    boxRef.current?.querySelectorAll('[data-reserve-line]')[currentRef.current] ??
    activeRef.current;

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let last = box.scrollTop;
    let inputAt = -Infinity;
    let scrollAt = -Infinity;
    let resumeCheck = 0;
    const atBottom = () =>
      atFollowBottom(
        {
          scrollTop: box.scrollTop,
          clientHeight: box.clientHeight,
          scrollHeight: box.scrollHeight,
        },
        followAt.current,
      );
    // While stopped, look again once the box could have been still long enough.
    const scheduleResume = () => {
      clearTimeout(resumeCheck);
      if (follow.current.following) return;
      resumeCheck = window.setTimeout(() => {
        const now = performance.now();
        if (
          mayResume(follow.current, {
            atBottom: atBottom(),
            sinceInput: now - inputAt,
            sinceScroll: now - scrollAt,
          })
        ) {
          follow.current = { following: true, movedAway: false };
          followNow.current();
        }
      }, RESUME_AFTER_MS);
    };
    const apply = (event: FollowEvent) => {
      follow.current = nextFollow(follow.current, event);
      if (!follow.current.following) cancelFollow(box);
      scheduleResume();
    };
    const input = (toward: 'up' | 'down' | 'none') => {
      inputAt = performance.now();
      apply({ kind: 'input', toward });
    };
    const onWheel = (event: WheelEvent) =>
      input(event.deltaY < 0 ? 'up' : event.deltaY > 0 ? 'down' : 'none');
    const onTouch = () => input('none');
    // A press on the box's own scrollbar, not on a row inside it.
    const onPointerDown = (event: PointerEvent) => {
      const r = box.getBoundingClientRect();
      const onBar =
        event.clientX >= r.left + box.clientLeft + box.clientWidth ||
        event.clientY >= r.top + box.clientTop + box.clientHeight;
      if (onBar) input('none');
    };
    const UP = new Set(['ArrowUp', 'PageUp', 'Home']);
    const DOWN = new Set(['ArrowDown', 'PageDown', 'End', ' ']);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (UP.has(event.key)) input('up');
      else if (DOWN.has(event.key)) input('down');
    };
    const onScroll = () => {
      const to = box.scrollTop;
      const ours = isOurScroll(box, last, to);
      if (!ours) scrollAt = performance.now();
      apply({ kind: 'scroll', from: last, to, atBottom: atBottom(), ours });
      last = to;
    };
    box.addEventListener('wheel', onWheel, { passive: true });
    box.addEventListener('touchstart', onTouch, { passive: true });
    box.addEventListener('pointerdown', onPointerDown, { passive: true });
    box.addEventListener('keydown', onKeyDown);
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(resumeCheck);
      box.removeEventListener('wheel', onWheel);
      box.removeEventListener('touchstart', onTouch);
      box.removeEventListener('pointerdown', onPointerDown);
      box.removeEventListener('keydown', onKeyDown);
      box.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    if (layout === 'unknown') return;
    if (current === 0) follow.current = { following: true, movedAway: false };
    const box = boxRef.current;
    const line = currentLine();
    if (!box || !line) return;
    const keepUp = () => {
      if (follow.current.following) followAt.current = followStepInside(box, line, !reduced);
    };
    followNow.current = keepUp;
    keepUp();
    // A row grows as it is typed and wraps (the phone measures a reserve copy
    // that is already full height, so this changes nothing there).
    if (typeof ResizeObserver === 'undefined') return;
    const grows = new ResizeObserver(keepUp);
    grows.observe(line);
    return () => grows.disconnect();
  }, [current, reduced, layout]);

  const visibleText = (i: number): string => {
    if (i < current) return lines[i]!.text;
    if (i === current) return typed.i === current ? lines[i]!.text.slice(0, typed.n) : '';
    return '';
  };

  // ON A PHONE HELD UPRIGHT THE TERMINAL IS AT MOST 45% OF THE SCREEN. It
  // scrolls inside itself, so a swipe that starts on it moves the transcript
  // and only hands on to the page at the transcript's end. At 62% to 70% of the
  // screen (measured at 375x667 and 390x844) it was where most swipes started,
  // and the page seemed stuck. Under half, there is always page above or below
  // it to scroll from, as well as the gutter beside it. The cap is the
  // `scroll-cap` utility (globals.css), a whole number of pixels on purpose.
  // `phone:` with a 500px floor on the height is the `phone-tall:` variant
  // spelled so the class still starts with `phone:`, which is how
  // tests/e2e/replay-wide-unchanged.spec.ts tells phone classes from main's.
  // No `overscroll-behavior` is set, here or anywhere: at either end the
  // scroll chains to the page.
  // THE CAP IS LESS THE CLOSED "KEY" ABOVE IT: `--scroll-cap-less`, which this
  // box inherits from the box Replay wraps it in on a phone (see the note
  // there and on the token in globals.css).
  return (
    <div
      ref={boxRef}
      data-elev="2"
      className={`overflow-y-auto ${TERMINAL_TEXT_CLASS} phone:grid phone:h-auto! phone:min-h-0 phone:grid-cols-[minmax(0,1fr)] phone:[container-type:normal]! phone:[@media(min-height:500px)]:scroll-cap`}
      style={{
        // Less its title bar, so the window is the height this box was.
        height: 'calc(clamp(280px, 40vh, 460px) - var(--title-bar-h))',
        background: TERMINAL_BG,
        containerType: 'size',
      }}
    >
      {/* The list points at the colour key in the legend Replay draws above
          this terminal (ReplayKey): one reference, from the element that holds
          every coloured line, and not one on each of the lines. */}
      <ol
        aria-label="Attack replay step timeline"
        aria-describedby={REPLAY_KEY_ID}
        data-asi-quoted="trace"
        className="phone:[grid-area:1/1]"
        onKeyDown={onRowKey}
      >
        {steps.map((step, i) => {
          const meta = stepMeta(step.type);
          const line = lines[i]!;
          const breach = i === compromiseIndex;
          const active = i === current;
          const reached = i <= current;
          const color = breach ? 'var(--text-breach)' : 'var(--text-readout)';
          const handle = handleForStep(step, model);
          return (
            <li
              key={step.id}
              ref={active ? activeRef : undefined}
              // A column, so the handle's definition (first in the document,
              // `order-last` on screen) opens UNDER the row it belongs to.
              className={reached ? 'relative flex flex-col' : 'sr-only'}
            >
              {reached && handle !== null && (
                <SpeakerHandle handle={handle} className="order-last" />
              )}
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                aria-label={`Step ${i + 1}: ${meta.label}${breach ? ', the agent was compromised here' : ''}`}
                // A step that is not drawn is not a tab stop (see the note above).
                tabIndex={reached ? undefined : -1}
                onClick={() => onSelect(i)}
                // At least `--target-min` tall (UI audit 2026-10-12, batch B). A
                // line that wraps already was; a one-line step was 24px, with
                // the next step's line directly under it. A hit area could not
                // fix that without overlapping its neighbour, so the row
                // itself is the height, and a short line sits in the middle
                // of it. The terminal's own height does not change: it is a
                // fixed clamp from 768px up and capped on a phone.
                className="relative block min-h-(--target-min) w-full whitespace-pre-wrap break-words text-left focus-inside focus-visible:underline"
                style={{ color }}
              >
                {/* THE COMPROMISE STEP IS NOT RED ALONE (UI audit 2026-10-12,
                    batch C; WCAG 1.4.1). Its line was the same text as every
                    other line in a different colour, which says nothing to a
                    reader who cannot tell the two colours apart. It carries
                    the breach diamond as well, the same shape the leaderboard
                    draws for the breach band. The mark sits in the box's left
                    padding, out of the flow, so no line moves, wraps or grows
                    and the height held back for the transcript on a phone is
                    what it was. The button's name already says "compromise
                    step", so the mark is hidden from assistive technology. */}
                {breach && (
                  <span
                    data-breach-mark=""
                    aria-hidden="true"
                    className="pointer-events-none absolute -left-3.5 top-1/2 -translate-y-1/2"
                  >
                    <BandShape band="breach" />
                  </span>
                )}
                {line.kind === 'out' ? (
                  <span className="pl-4">
                    <span aria-hidden="true" style={{ color: 'var(--terminal-prompt)' }}>
                      {line.marker}{' '}
                    </span>
                    {visibleText(i)}
                  </span>
                ) : (
                  <>
                    <span aria-hidden="true" style={{ color: 'var(--terminal-prompt)' }}>
                      <PrintedHandle handle={line.kind === 'input' ? OPERATOR_HANDLE : agentAt} />
                      :~${' '}
                    </span>
                    {visibleText(i)}
                  </>
                )}
                {active && (
                  <span
                    aria-hidden="true"
                    className={`${TERMINAL_CARET_CLASS} motion-safe:[animation:cursor-blink_1.05s_step-end_infinite]`}
                    style={{ background: color }}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {layout !== 'wide' && (
        <div
          aria-hidden="true"
          data-terminal-reserve=""
          className="invisible hidden phone:block phone:[grid-area:1/1]"
        >
          {lines.map((line, i) => (
            <div
              key={steps[i]!.id}
              data-reserve-line=""
              // The same floor as the row it stands in for, so the height
              // held back for a step is the height the step will have.
              className="min-h-(--target-min) whitespace-pre-wrap break-words"
            >
              <span
                data-text={
                  line.kind === 'out'
                    ? `${line.marker} ${line.text}`
                    : `${line.kind === 'input' ? userPrompt : agentPrompt}$ ${line.text}`
                }
                // The text, and on the LAST line room for the cursor it ends the
                // run with. An earlier line whose cursor wraps it one line longer
                // still fits: every line after it is reserved and not yet drawn.
                className={cn(
                  'before:content-[attr(data-text)]',
                  line.kind === 'out' && 'pl-4',
                  i === lines.length - 1 &&
                    "after:ml-px after:inline-block after:w-[0.55ch] after:content-['']",
                )}
              />
            </div>
          ))}
        </div>
      )}
      {/* Bottom room so the final lines can pin to the vertical middle. Not on a
          phone, where the terminal ends at its last line. */}
      <div aria-hidden="true" className="phone:hidden" style={{ height: '46cqh' }} />
    </div>
  );
}
