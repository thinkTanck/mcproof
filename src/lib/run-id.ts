/**
 * WHAT A RUN ID CAN LOOK LIKE, as plain strings and one pattern.
 *
 * Two kinds of run are addressed by `/runs/[id]` and `/findings/[id]`: a sample,
 * under one of the ids below, and a stored live run, under its row id. This
 * module says which strings could be either, WITHOUT resolving anything, so the
 * middleware can import it: it holds no attack module, no builder and no
 * database client.
 *
 * `SAMPLE_RUN_IDS` is a written-out copy of what the sample library serves
 * (`sampleRun(category).runId`, plus the `sample` alias). The library builds
 * those ids from the attack modules, which must never reach the middleware
 * bundle, so the list cannot be derived here. `tests/unit/lib/run-id.test.ts`
 * holds the two equal: a renamed or added sample fails there until this agrees.
 */
export const SAMPLE_RUN_IDS = [
  'sample',
  'asi01-goal-hijack',
  'asi02-run',
  'asi03-identity-privilege-abuse',
  'asi04-run',
  'asi05-code-execution',
  'asi06-run',
  'asi10-goal-drift',
] as const;

/** The shape of a stored run's address: `runs.id` is a uuid column. */
const ROW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `id` is shaped like a stored run's row id. Says nothing about whether one exists. */
export function isRowId(id: string): boolean {
  return ROW_ID.test(id);
}

/**
 * Whether `id` could address a run at all: a sample id, or something shaped like
 * a row id. `false` is certain (nothing can resolve it); `true` only means it is
 * worth looking up.
 */
export function couldBeRunId(id: string): boolean {
  return (SAMPLE_RUN_IDS as readonly string[]).includes(id) || isRowId(id);
}

/** Where the middleware sends an id that cannot be a run, per route. */
export const MISSING_RUN_PATHS = {
  runs: '/missing/run',
  findings: '/missing/report',
} as const;
