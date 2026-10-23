import type { Step } from '@/contract';
import { SESSION_ENDED, SESSION_ENDED_NOTE, isInferredSessionEnd } from '@/lib/replay/session-end';

/**
 * Presentation metadata for the seven observable step types. Every node carries
 * a label + a glyph (an SVG path d) so a node is never distinguishable by colour
 * alone. `band` maps to the tri-state token family; the compromise step overrides
 * to breach at render time (from verdict.stepId), never baked into the type.
 */
export type NodeBand = 'nominal' | 'caution' | 'neutral';

export type StepMeta = {
  label: string;
  /** Short mono tag shown on the node. */
  tag: string;
  band: NodeBand;
  /** SVG path within a 16x16 viewBox. */
  glyph: string;
};

const META: Record<Step['type'], StepMeta> = {
  // The principal's own instruction. Neutral, not caution: the authority setting
  // the task is not a hazard, and typing it as one was the defect ADR-0011 fixed.
  principal_instruction: {
    label: "Operator's task",
    tag: 'TASK',
    band: 'neutral',
    glyph: 'M3.5 3.5l4 4.5-4 4.5 M9 12.5h4',
  },
  agent_reasoning: {
    label: 'Agent reasoning',
    tag: 'REASONING',
    band: 'neutral',
    glyph: 'M5 3h6v6l-3 4-3-4z M5 3v6 M11 3v6',
  },
  tool_call: {
    label: 'Tool call',
    tag: 'TOOL CALL',
    band: 'nominal',
    glyph: 'M10.5 2.5a3 3 0 0 0-4 4l-4 4 2 2 4-4a3 3 0 0 0 4-4l-2 2-1.5-.5-.5-1.5z',
  },
  tool_result: {
    label: 'Tool result',
    tag: 'TOOL RESULT',
    band: 'nominal',
    glyph: 'M3 8l3 3 7-7',
  },
  memory_read: {
    label: 'Memory read',
    tag: 'MEMORY READ',
    band: 'caution',
    glyph:
      'M3 4.5C3 3.7 4.8 3 8 3s5 .7 5 1.5v7C13 12.3 11.2 13 8 13s-5-.7-5-1.5z M3 4.5C3 5.3 4.8 6 8 6s5-.7 5-1.5',
  },
  memory_write: {
    label: 'Memory write',
    tag: 'MEMORY WRITE',
    band: 'caution',
    glyph:
      'M3 4.5C3 3.7 4.8 3 8 3s5 .7 5 1.5v7C13 12.3 11.2 13 8 13s-5-.7-5-1.5z M6 8.5l1.5 1.5L11 6.5',
  },
  task_complete: {
    label: 'Task complete',
    tag: 'COMPLETE',
    band: 'nominal',
    glyph: 'M2.5 8.5l3.5 3.5 7.5-8',
  },
};

export function stepMeta(type: Step['type']): StepMeta {
  return META[type];
}

/** One-line human summary of a step, for the node caption + timeline. */
export function stepSummary(step: Step): string {
  switch (step.type) {
    case 'principal_instruction':
      return 'the operator gives the task';
    case 'agent_reasoning':
      return 'the agent plans its next step';
    case 'tool_call':
      return `calls ${step.tool}`;
    case 'tool_result':
      return `${step.tool} returns`;
    case 'memory_read':
      return `reads memory · ${step.key}`;
    case 'memory_write':
      return `writes memory · ${step.key}`;
    case 'task_complete':
      // The recorder's inferred end marker reads as the owner's sentence.
      if (isInferredSessionEnd(step.summary)) return SESSION_ENDED;
      return step.summary ? step.summary : 'the run ends';
  }
}

/** Pretty-print an observable JSON payload for the detail panel. */
export function formatPayload(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * The key/value payload rows for a step's detail panel. Observable fields only
 * (args / result / content / memory key+value / summary) — never GroundTruth.
 */
export function stepPayload(step: Step): { k: string; v: string }[] {
  switch (step.type) {
    case 'principal_instruction':
      return [{ k: 'instruction', v: step.content }];
    case 'agent_reasoning':
      return [{ k: 'reasoning', v: step.content }];
    case 'tool_call':
      return [
        { k: 'tool', v: step.tool },
        { k: 'args', v: formatPayload(step.args) },
      ];
    case 'tool_result':
      return [
        { k: 'tool', v: step.tool },
        { k: 'result', v: formatPayload(step.result) },
      ];
    case 'memory_read':
      return [
        { k: 'key', v: step.key },
        { k: 'value', v: formatPayload(step.value) },
      ];
    case 'memory_write':
      return [
        { k: 'key', v: step.key },
        { k: 'value', v: formatPayload(step.value) },
      ];
    case 'task_complete':
      // The inferred end marker: the sentence, and a note saying why it is
      // inferred, in place of the recorder's own words (LAUNCH POLISH, 5a).
      if (isInferredSessionEnd(step.summary)) {
        return [
          { k: 'summary', v: SESSION_ENDED },
          { k: 'note', v: SESSION_ENDED_NOTE },
        ];
      }
      return [{ k: 'summary', v: step.summary ?? 'run complete' }];
  }
}
