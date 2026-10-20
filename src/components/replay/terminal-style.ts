/**
 * THE REPLAY TERMINAL LOOK, written once (owner ruling ABOUT REVISION,
 * 2026-10-19). The replay's transcript terminal and the /about terminals read
 * these, so the two cannot drift: the box (padding, corner, mono at 15px on a
 * 1.6 line), the terminal background, the lifted surface (`data-elev="2"`),
 * the amber prompt, the cyan readout and the block caret's size.
 */
export const TERMINAL_TEXT_CLASS = 'rounded-lg px-4 py-3 font-mono text-[15px] leading-[1.6]';
export const TERMINAL_BG = 'var(--terminal-bg)';
export const TERMINAL_ELEV = '2';
export const TERMINAL_PROMPT_COLOR = 'var(--terminal-prompt)';
export const TERMINAL_READOUT_COLOR = 'var(--text-readout)';
/** The caret's box. Its blink is applied by each user, motion-safe. */
export const TERMINAL_CARET_CLASS = 'ml-px inline-block h-[1.05em] w-[0.55ch] translate-y-[0.18em]';
