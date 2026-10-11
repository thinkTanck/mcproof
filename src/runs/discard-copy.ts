/**
 * THE WORDS FOR A DISCARDED RUN, in one place.
 *
 * A discard is said in four places: the control and its confirm step on
 * `/connect`, the pipeline's typed refusal, and the state `/runs/[id]` and
 * `/findings/[id]` show for a run that was discarded. They are the same facts,
 * so they are the same strings, and none of them can drift from the others.
 *
 * Plain strings and nothing else: no import, no `node:` anything, so the
 * pipeline, a server component and a client component can all read this file.
 *
 * No numeral appears here. The free-run allowance is configuration
 * (`LIVE_RUN_ALLOWANCE`), and the only place it becomes words is
 * `describeLiveRunAllowance()`; these sentences say that a discarded run still
 * counts toward it without quoting how many there are.
 */

/** The control. */
export const DISCARD_RUN_LABEL = 'DISCARD RUN';

/** The confirm step. The approved wording, exactly. */
export const DISCARD_CONFIRM_QUESTION =
  'Discard this run? It ends now, its token stops working, and it is not judged.';
export const DISCARD_CONFIRM_YES = 'DISCARD';
export const DISCARD_CONFIRM_NO = 'KEEP RUNNING';

/** What the run bar reads while the call is in flight, and once it is done. */
export const DISCARDING_LABEL = 'DISCARDING';
export const RUN_DISCARDED_LABEL = 'RUN DISCARDED';

/** The one sentence every screen says about a discarded run. */
export const RUN_DISCARDED_SENTENCE = 'This run was discarded and not judged.';

/** The tab title of a discarded run's replay and report pages. */
export const RUN_DISCARDED_TITLE = 'Run discarded · MCProof';

/** What a discard costs, said wherever one is offered or has happened. */
export const DISCARD_STILL_COUNTS_SENTENCE = 'It still counts toward your free live runs.';
