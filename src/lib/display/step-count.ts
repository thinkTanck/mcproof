/**
 * THE SENTENCE UNDER A LIVE RUN'S COUNTS (LAUNCH POLISH, Part 5b; owner ruling
 * COPY FIX, 2026-10-21).
 *
 * A run's trace always holds two steps of ours: the task we sent first, and the
 * end marker the recorder adds when the session closes. The rest are the
 * agent's tool calls and our replies to them. With no tool call at all the old
 * sentence ("Two of them are ours ... The rest are your agent's tool calls")
 * described steps that did not exist, so that case has its own sentence, and
 * every count reads in the right number.
 */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function stepCountSentence({
  steps,
  toolCalls,
}: {
  readonly steps: number;
  readonly toolCalls: number;
}): string {
  if (toolCalls === 0) {
    return (
      `The run has ${plural(steps, 'step', 'steps')}: the task we sent and the end marker we add. ` +
      'Your agent made no tool calls.'
    );
  }
  const rest = toolCalls === 1 ? 'tool call and our reply' : 'tool calls and our replies';
  return (
    `The run has ${plural(steps, 'step', 'steps')} in total. Two of them are ours: the task we ` +
    `sent, and a last step we add to mark the end of the run. The rest are your agent's ${rest}.`
  );
}
