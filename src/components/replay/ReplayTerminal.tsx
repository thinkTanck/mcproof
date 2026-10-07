'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '@/lib/hud/reduced-motion';
import { stepMeta } from './step-meta';
import type { Step } from '@/contract';

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
      return { kind: 'cmd', text: `exit 0  # ${step.summary ?? 'run complete'}` };
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
  const userPrompt = 'user@console:~';
  const agentPrompt = `${model}@sentinel:~`;

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

  // Hold the active line around the vertical middle (block:'center'): early lines
  // sit near the top because there is nothing to scroll above them, and once the
  // stream passes the midline the newest line pins to centre. Guarded because
  // jsdom (unit tests) does not implement scrollIntoView.
  useEffect(() => {
    const el = activeRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    }
  }, [current, reduced]);

  const visibleText = (i: number): string => {
    if (i < current) return lines[i]!.text;
    if (i === current) return typed.i === current ? lines[i]!.text.slice(0, typed.n) : '';
    return '';
  };

  return (
    <div
      className="overflow-y-auto rounded-lg px-4 py-3 font-mono text-[15px] leading-[1.6]"
      style={{
        height: 'clamp(280px, 40vh, 460px)',
        background: 'var(--terminal-bg)',
        containerType: 'size',
      }}
    >
      <ol aria-label="Attack replay step timeline">
        {steps.map((step, i) => {
          const meta = stepMeta(step.type);
          const line = lines[i]!;
          const breach = i === compromiseIndex;
          const active = i === current;
          const reached = i <= current;
          const color = breach ? 'var(--text-breach)' : 'var(--text-readout)';
          return (
            <li
              key={step.id}
              ref={active ? activeRef : undefined}
              className={reached ? '' : 'sr-only'}
            >
              <button
                type="button"
                aria-current={active ? 'step' : undefined}
                aria-label={`Step ${i + 1}: ${meta.label}${breach ? ', compromise step' : ''}`}
                // A step that is not drawn is not a tab stop (see the note above).
                tabIndex={reached ? undefined : -1}
                onClick={() => onSelect(i)}
                className="block w-full whitespace-pre-wrap break-words text-left focus:outline-none focus-visible:underline"
                style={{ color }}
              >
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
                      {line.kind === 'input' ? userPrompt : agentPrompt}${' '}
                    </span>
                    {visibleText(i)}
                  </>
                )}
                {active && (
                  <span
                    aria-hidden="true"
                    className="ml-px inline-block h-[1.05em] w-[0.55ch] translate-y-[0.18em] motion-safe:[animation:cursor-blink_1.05s_step-end_infinite]"
                    style={{ background: color }}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {/* Bottom room so the final lines can pin to the vertical middle. */}
      <div aria-hidden="true" style={{ height: '46cqh' }} />
    </div>
  );
}
