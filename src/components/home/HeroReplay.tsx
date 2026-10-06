import { cn } from '@/lib/utils';
import { stepColorToken } from '@/lib/hud/trace-view';
import type { Step } from '@/contract';

/**
 * HERO MICRO-REPLAY — a compact, self-playing replay of the FEATURED sample trace
 * (ASI02), sitting where the sentinel-core globe used to. It reads as a recorded
 * replay of the actual finding rather than decoration: the agent's steps thread a
 * signal rail and the breach node breaks it at the offending `read_file` step
 * (`s6`), the same step the SampleTrailer badges. It is labelled RECORDED, never
 * live: the trace is a constructed sample fixture, not a captured live run.
 *
 * BOUND, NEVER LITERAL. Every node comes from the real sample `RunResult` the
 * caller passes (`trace.steps` + the compromise index derived from
 * `verdict.stepId`), so it can never drift from the run the rest of the page
 * shows. Nothing here is a hardcoded step count or label.
 *
 * MOTION IS SAFE AND HONEST. SVG-free, transform/opacity only. The RESTING state
 * (what `prefers-reduced-motion` snaps to, via the global reduce block in
 * globals.css) is the whole trace fully legible with the breach lit; the
 * animation only adds a traveling sweep of emphasis over an already-complete
 * picture. Step numerals are rendered at their final value and never counted or
 * animated (they are evidence, not a magnitude).
 */

/** A reader-locatable label for a step: the tool it called, or the kind of step. */
function label(step: Step): string {
  switch (step.type) {
    case 'principal_instruction':
      return 'principal instruction';
    case 'agent_reasoning':
      return 'agent reasoning';
    case 'tool_call':
      return step.tool;
    case 'tool_result':
      return `${step.tool} result`;
    case 'memory_read':
      return 'memory read';
    case 'memory_write':
      return 'memory write';
    case 'task_complete':
      return 'complete';
  }
}

export function HeroReplay({
  steps,
  compromiseIndex,
  offendingTool,
  category,
}: {
  steps: readonly Step[];
  /** 1-based index of the offending step (from `verdict.stepId`). */
  compromiseIndex: number;
  /** The offending step's tool/label, for the accessible summary. */
  offendingTool: string;
  /** The featured category code, e.g. "ASI02". */
  category: string;
}) {
  const total = steps.length;
  // The whole replay is ONE image with a text alternative, the way the trailer's
  // dot strip is: the animated rail is decorative once the sentence is read.
  const summary = `${category} sample replay: ${total} steps, an out-of-scope ${offendingTool} at step ${compromiseIndex} lights as the breach.`;

  return (
    <div
      role="img"
      aria-label={summary}
      className="overflow-hidden rounded-xl border border-line bg-[radial-gradient(120%_120%_at_50%_0%,color-mix(in_srgb,var(--cyan-700)_14%,transparent),var(--surface-base)_72%)] px-4 py-3.5"
    >
      {/* Honest eyebrow: this is a RECORDED constructed sample, never a live run.
          No green "live" dot, consistent with how the rest of the site labels a
          constructed demonstration. */}
      <div aria-hidden="true" className="mb-3 flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-nominal">
          {category} · sample replay
        </span>
        <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[12px] uppercase tracking-[0.12em] text-ink-faint">
          Recorded
        </span>
      </div>

      {/* The rail is the content. A thin spine threads the step nodes into one
          signal trace, and the breach node breaks it: a larger reticle, a red
          band and a bolder label make the compromise the focal point. */}
      <ol aria-hidden="true" className="relative flex flex-col">
        {steps.map((step, i) => {
          const breach = i + 1 === compromiseIndex;
          const id = `s${i + 1}`;
          const isFirst = i === 0;
          const isLast = i === total - 1;
          // Stagger the sweep so a highlight travels down the rail; the delay is
          // the only per-node inline style, and it does nothing under reduced motion.
          const delay = `${(i * 0.42).toFixed(2)}s`;
          // The spine segment for this row, capped cleanly at the first/last node.
          const spine =
            total === 1
              ? 'hidden'
              : isFirst
                ? 'top-1/2 bottom-0'
                : isLast
                  ? 'top-0 bottom-1/2'
                  : 'inset-y-0';
          return (
            <li
              key={step.id}
              data-testid="hero-step"
              data-breach={breach ? 'true' : 'false'}
              className={cn('flex items-center gap-3 rounded-md', breach ? 'py-1.5' : 'py-[3px]')}
              style={
                breach
                  ? { backgroundColor: 'color-mix(in srgb, var(--red-400) 9%, transparent)' }
                  : undefined
              }
            >
              <div className="relative flex w-5 shrink-0 items-center justify-center self-stretch">
                <span
                  aria-hidden="true"
                  className={cn('absolute left-1/2 w-px -translate-x-1/2 bg-line', spine)}
                />
                {breach ? (
                  <span
                    data-testid="hero-breach-marker"
                    className="hero-breach-dot relative z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--surface-base)]"
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                      <circle
                        cx="9"
                        cy="9"
                        r="7"
                        fill="none"
                        stroke="var(--status-breach)"
                        strokeWidth="1.4"
                      />
                      <circle cx="9" cy="9" r="2.6" fill="var(--status-breach)" />
                      <path
                        d="M9 0.5v2.4M9 15.1v2.4M0.5 9h2.4M15.1 9h2.4"
                        stroke="var(--status-breach)"
                        strokeWidth="1.2"
                      />
                    </svg>
                  </span>
                ) : (
                  <span className="relative z-10 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-[var(--surface-base)]">
                    <span
                      aria-hidden="true"
                      className="hero-sweep absolute inset-[-5px] rounded-full"
                      style={{
                        background:
                          'radial-gradient(circle, color-mix(in srgb, var(--cyan-300) 70%, transparent), transparent 70%)',
                        animationDelay: delay,
                      }}
                    />
                    <span
                      className="relative h-2.5 w-2.5 rounded-full"
                      style={{ background: stepColorToken(step.type) }}
                    />
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'w-[22px] shrink-0 font-mono text-[12px] tabular-nums',
                  breach ? 'text-breach-text' : 'text-ink-muted',
                )}
              >
                {id}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate font-mono text-[13px]',
                  breach ? 'font-semibold text-breach-text' : 'text-ink',
                )}
              >
                {label(step)}
              </span>
              {breach && (
                <span className="shrink-0 rounded-sm border border-breach/50 bg-breach/10 px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-[0.1em] text-breach-text">
                  Breach
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
