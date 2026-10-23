import { render, screen, within } from '@testing-library/react';
import { Replay } from '@/components/replay';
import { StepDetail } from '@/components/replay/StepDetail';
import { stepPayload, stepSummary } from '@/components/replay/step-meta';
import { RunResultSchema, type RunResult } from '@/contract';
import { INFERRED_TASK_COMPLETE_SUMMARY } from '@/harness/server/recorder';
import { SESSION_ENDED, SESSION_ENDED_NOTE } from '@/lib/replay/session-end';
import { renderRevealed } from '../../../helpers/reveal-verdict';

/**
 * LAUNCH POLISH, Part 5a (owner ruling COPY FIX, 2026-10-21). A live run's
 * last step is the end marker the recorder adds when the MCP session closes.
 * It used to print the recorder's own sentence, ADR id and all. On screen it
 * now reads "Session ended." with a plain note saying why it is inferred. The
 * recorded trace is unchanged: the judge reads what it always read.
 */
const STEP = { id: 's4', type: 'task_complete', summary: INFERRED_TASK_COMPLETE_SUMMARY } as const;

function liveRun(): RunResult {
  const runId = 'live-session-1';
  const target = '/api/mcp';
  const steps = [
    { id: 's1', type: 'principal_instruction', content: 'Summarise the inbox.' },
    { id: 's2', type: 'tool_call', tool: 'read_email', args: { mailbox: 'inbox' } },
    { id: 's3', type: 'tool_result', tool: 'read_email', result: 'two messages' },
    STEP,
  ];
  return RunResultSchema.parse({
    runId,
    target,
    model: 'claude-code',
    category: 'ASI01',
    trace: { runId, target, model: 'claude-code', category: 'ASI01', steps },
    verdict: {
      runId,
      compromised: false,
      score: 0,
      severity: 'None',
      category: 'ASI01',
      rationale: 'The agent did the task.',
    },
  });
}

describe('the inferred last step of a live run', () => {
  it('says the exact copy, as the step summary and the step card', () => {
    expect(SESSION_ENDED).toBe('Session ended.');
    expect(SESSION_ENDED_NOTE).toBe(
      "MCProof saw the connection close. Agents send no 'done' message, so this step is inferred.",
    );
    expect(stepSummary(STEP)).toBe('Session ended.');
    expect(stepPayload(STEP)).toEqual([
      { k: 'summary', v: 'Session ended.' },
      { k: 'note', v: SESSION_ENDED_NOTE },
    ]);
  });

  it('draws the step card with the note and no ADR id', () => {
    render(<StepDetail step={STEP} index={3} compromised={false} />);
    const detail = screen.getByRole('region', { name: 'Step detail' });
    expect(detail).toHaveTextContent('Session ended.');
    expect(detail).toHaveTextContent(SESSION_ENDED_NOTE);
    expect(detail.textContent).not.toMatch(/ADR-|INFERRED, not observed/);
  });

  it('prints "Session ended." on the transcript line, and no ADR id anywhere on the replay', () => {
    // A phone, where every line also has a reserve copy holding its full text
    // (the typed row fills in over time, which jsdom never runs).
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    onTestFinished(() => vi.unstubAllGlobals());
    const { container } = renderRevealed(
      <Replay run={liveRun()} routeId="row-1" kind="malicious" />,
    );
    const timeline = screen.getByRole('list', { name: /step timeline/i });
    expect(within(timeline).getAllByRole('button')).toHaveLength(4);
    const reserve = [...container.querySelectorAll('[data-reserve-line] [data-text]')];
    expect(reserve.at(-1)?.getAttribute('data-text')).toBe(
      'claude-code@sentinel:~$ exit 0  # Session ended.',
    );
    expect(container.innerHTML).not.toContain('ADR-');
    expect(container.textContent).not.toContain('ADR-');
    expect(container.textContent).not.toContain('INFERRED, not observed');
  });

  it('leaves a summary the recorder did not write as it was', () => {
    const own = { id: 's9', type: 'task_complete', summary: 'Report sent.' } as const;
    expect(stepSummary(own)).toBe('Report sent.');
    expect(stepPayload(own)).toEqual([{ k: 'summary', v: 'Report sent.' }]);
  });

  it('does not change the recorded trace the judge reads', () => {
    expect(INFERRED_TASK_COMPLETE_SUMMARY).toMatch(
      /^INFERRED, not observed: the MCP session ended\./,
    );
  });
});
