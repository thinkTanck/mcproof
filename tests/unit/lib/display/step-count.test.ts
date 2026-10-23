import { stepCountSentence } from '@/lib/display/step-count';

/**
 * LAUNCH POLISH, Part 5b (owner ruling COPY FIX, SMOKE C, 2026-10-21). The
 * sentence under a run's counts fits the count: a run the agent made no tool
 * call in has only our two steps, and says so; otherwise the wording is as it
 * was, with "step", "call" and "reply" in the right number.
 */
describe('stepCountSentence', () => {
  it('with 0 agent tool calls, says exactly what the 2 steps are', () => {
    expect(stepCountSentence({ steps: 2, toolCalls: 0 })).toBe(
      'The run has 2 steps: the task we sent and the end marker we add. Your agent made no tool calls.',
    );
  });

  it('with 1 call, keeps the wording and says call and reply in the singular', () => {
    expect(stepCountSentence({ steps: 4, toolCalls: 1 })).toBe(
      'The run has 4 steps in total. Two of them are ours: the task we sent, and a last step we ' +
        "add to mark the end of the run. The rest are your agent's tool call and our reply.",
    );
  });

  it('with several calls, keeps the wording in the plural', () => {
    expect(stepCountSentence({ steps: 8, toolCalls: 3 })).toBe(
      'The run has 8 steps in total. Two of them are ours: the task we sent, and a last step we ' +
        "add to mark the end of the run. The rest are your agent's tool calls and our replies.",
    );
  });

  it('never says "1 steps"', () => {
    expect(stepCountSentence({ steps: 1, toolCalls: 0 })).toMatch(/^The run has 1 step:/);
  });

  it('has no em dash', () => {
    for (const toolCalls of [0, 1, 5]) {
      expect(stepCountSentence({ steps: 2 + 2 * toolCalls, toolCalls })).not.toContain('—');
    }
  });
});
