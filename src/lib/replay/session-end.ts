/**
 * THE END MARKER OF A LIVE RUN, AS A PERSON READS IT (LAUNCH POLISH, Part 5a;
 * owner ruling COPY FIX, 2026-10-21).
 *
 * MCP has no message by which an agent says it is done, so the recorder adds a
 * last `task_complete` step when the session closes, and labels it inferred in
 * its own words (`INFERRED_TASK_COMPLETE_SUMMARY` in
 * `src/harness/server/recorder.ts`). Those words are part of the recorded trace
 * and the judge reads them, so they are not changed. What changes is what the
 * screen prints for them: the owner's sentence and a plain note, with no ADR id
 * and no internal terms.
 *
 * The marker is recognised by its opening words rather than imported from the
 * recorder, so a client component never pulls the hosted server in, and a run
 * stored under an earlier wording of the same sentence still reads the same.
 */
export const SESSION_ENDED = 'Session ended.';

export const SESSION_ENDED_NOTE =
  "MCProof saw the connection close. Agents send no 'done' message, so this step is inferred.";

/** Whether a `task_complete` summary is the recorder's inferred end marker. */
export function isInferredSessionEnd(summary: string | undefined): boolean {
  return summary !== undefined && /^INFERRED, not observed\b/.test(summary);
}
