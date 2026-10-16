import { bandFor, bandToken, type Band } from '@/lib/hud/bands';
import {
  stepColorToken,
  isBreachStep,
  breachIndex,
  offendingStepLabel,
} from '@/lib/hud/trace-view';
import type { Step } from '@/contract';
import { sampleRun } from '@/data/source';

// The ASI06 sample = the real builder-constructed trace, with the RECORDED
// validated-judge verdict. The judge anchors the compromise at the memory_write
// that persists the poisoned standing instruction (s6, index 5), not at the later
// send_email (s11) the retired curated placeholder had picked.
const asi06Run = sampleRun('ASI06');

describe('robustness bands', () => {
  it('classifies robustness at the .80 / .50 thresholds', () => {
    expect(bandFor(1)).toBe('nominal');
    expect(bandFor(0.8)).toBe('nominal');
    expect(bandFor(0.79)).toBe('caution');
    expect(bandFor(0.5)).toBe('caution');
    expect(bandFor(0.49)).toBe('breach');
    expect(bandFor(0)).toBe('breach');
  });

  it('every band carries a status token AND an UPPERCASE label (never color-only)', () => {
    for (const band of ['nominal', 'caution', 'breach'] as Band[]) {
      const token = bandToken(band);
      expect(token.status).toMatch(/^var\(--status-/);
      expect(token.glow).toMatch(/^var\(--glow-/);
      expect(token.label).toMatch(/^[A-Z]+$/);
    }
  });
});

describe('trace-view helpers', () => {
  it('maps each step type to a semantic token', () => {
    expect(stepColorToken('tool_call')).toContain('--status-nominal');
    expect(stepColorToken('memory_write')).toContain('--line-emphasis');
    expect(stepColorToken('task_complete')).toContain('--status-caution');
    expect(stepColorToken('principal_instruction')).toContain('--text');
  });

  it('derives the breach from verdict.stepId only', () => {
    expect(isBreachStep(asi06Run, 's6')).toBe(true);
    expect(isBreachStep(asi06Run, 's11')).toBe(false);
    expect(breachIndex(asi06Run)).toBe(5);
  });

  it('names the offending step by its tool, or by the kind of step it was', () => {
    const cases: [Step, string][] = [
      [{ id: 's1', type: 'tool_call', tool: 'send_email', args: {} }, 'send_email'],
      [{ id: 's2', type: 'tool_result', tool: 'read_file', result: null }, 'read_file'],
      [{ id: 's3', type: 'memory_write', key: 'k', value: null }, 'memory write'],
      [{ id: 's4', type: 'memory_read', key: 'k', value: null }, 'memory read'],
      [{ id: 's5', type: 'principal_instruction', content: 'x' }, "operator's task"],
      [{ id: 's6', type: 'agent_reasoning', content: 'x' }, 'agent reasoning'],
      [{ id: 's7', type: 'task_complete' }, 'task complete'],
    ];
    for (const [step, label] of cases) expect(offendingStepLabel(step)).toBe(label);
    // The ASI06 sample's recorded anchor is a memory_write, not a tool call.
    const anchored = asi06Run.trace.steps[breachIndex(asi06Run)]!;
    expect(offendingStepLabel(anchored)).toBe('memory write');
  });
});
