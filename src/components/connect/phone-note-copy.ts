/**
 * THE WORDS OF THE CONNECT PHONE NOTE, in one place.
 *
 * The sentence and the three links are the approved wording, exactly, and the
 * tests assert against these same strings so the screen cannot drift from them.
 * Plain strings and nothing else, so anything may import this file.
 */

export const PHONE_NOTE_TEXT =
  'Running a test needs a computer with a terminal or code editor. From your phone you can watch a sample run, read a fix report, and check the leaderboard.';

/** What a phone visitor can do instead, in the order the sentence names them. */
export const PHONE_NOTE_LINKS = [
  { label: 'Watch a sample run', href: '/runs/sample' },
  { label: 'Read a fix report', href: '/findings/sample' },
  { label: 'See the leaderboard', href: '/leaderboard' },
] as const;
