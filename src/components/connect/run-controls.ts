/**
 * WHERE "SKIP TO RUN CONTROLS" LANDS (UI audit 2026-10-12, batch B).
 *
 * One id, on exactly one element of the Connect screen at a time:
 *
 *   - while a run is on show, the RUN BAR (`RunBar` in LiveRunConsole), wherever
 *     it is drawn: leading the run column from 768px up, or in the slot at the
 *     bottom of a phone. It is already a region named by the run's heading.
 *   - while no run is on show, the block that STARTS one: the sample's play
 *     button, the sign-in gate, or ISSUE RUN ENDPOINT (ConnectScreen wraps
 *     whichever it is and names the wrapper `RUN_CONTROLS_LABEL`).
 *
 * So the skip link always has somewhere true to go. The element is focusable
 * by script only (`tabindex="-1"`): it is a place to land, not a tab stop.
 * It is never a live region; the one live region on the bar is the status
 * inside it.
 */
export const RUN_CONTROLS_ID = 'run-controls';

/** The name of the landing block while there is no run bar to carry the id. */
export const RUN_CONTROLS_LABEL = 'Run controls';
