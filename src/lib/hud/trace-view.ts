import type { RunResult, Step, StepType } from '@/contract';

/**
 * Presentation helpers over an observable trace. The breach is NOT a step
 * property — it is derived solely from `verdict.stepId` (leakage barrier), so
 * `isBreachStep` takes the run, not the step.
 */
export function stepColorToken(type: StepType): string {
  switch (type) {
    case 'principal_instruction':
      return 'var(--text)';
    case 'agent_reasoning':
      return 'var(--text-muted)';
    case 'tool_call':
    case 'tool_result':
      return 'var(--status-nominal)';
    case 'memory_read':
    case 'memory_write':
      return 'var(--line-emphasis)';
    case 'task_complete':
      return 'var(--status-caution)';
  }
}

export function isBreachStep(run: RunResult, stepId: string): boolean {
  return run.verdict.compromised && run.verdict.stepId === stepId;
}

/** Zero-based index of the offending step in the trace, or -1 if none. */
export function breachIndex(run: RunResult): number {
  const id = run.verdict.stepId;
  return id ? run.trace.steps.findIndex((s) => s.id === id) : -1;
}

/**
 * Name the offending step the way a reader can FIND it in the trace: the tool it
 * called, or the kind of step it was.
 *
 * Not every compromise is a tool call. The recorded validated-judge verdict for
 * the ASI06 sample anchors the `memory_write` that persists the poisoned standing
 * instruction, and a tool-call-only rule printed the run's CATEGORY there ("ASI06
 * breach"), which names the attack rather than the step and helps nobody locate
 * it.
 */
export function offendingStepLabel(step: Step): string {
  switch (step.type) {
    case 'tool_call':
    case 'tool_result':
      return step.tool;
    case 'memory_read':
      return 'memory read';
    case 'memory_write':
      return 'memory write';
    case 'principal_instruction':
      return "operator's task";
    case 'agent_reasoning':
      return 'agent reasoning';
    case 'task_complete':
      return 'task complete';
  }
}
