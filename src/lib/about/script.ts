import { SENTINEL_DEFINITION } from '@/lib/replay/roles';
import { ABOUT_BIO, ABOUT_NAME, MAN_HEADER, MAN_NAME_LINE } from './copy';

/**
 * THE /about TERMINAL SCRIPT (owner ruling ABOUT FINAL, 2026-10-20). One
 * session, `man sentinel` then `whoami`, played like a real terminal except
 * the paragraphs:
 *
 *  - a COMMAND types a key at a time, 60 to 120 ms a key, then pauses 300 to
 *    500 ms as if Enter was pressed;
 *  - a SHORT line prints whole, at once, like real output;
 *  - a PARAGRAPH streams at 15 to 25 ms a character, a fast reading pace;
 *  - a BLANK line, and at the end a fresh PROMPT with the caret.
 *
 * The variation comes from a fixed seed, so the server, the browser and the
 * tests all agree on what is showing at any moment.
 */
export type ScriptLine =
  | { readonly kind: 'command'; readonly text: string }
  | {
      readonly kind: 'short';
      readonly text: string;
      readonly parts?: readonly string[];
      readonly indent?: boolean;
    }
  | { readonly kind: 'paragraph'; readonly text: string; readonly indent?: boolean }
  | { readonly kind: 'blank'; readonly text: '' }
  | { readonly kind: 'prompt'; readonly text: '' };

const BLANK = { kind: 'blank', text: '' } as const;

export const ABOUT_SCRIPT: readonly ScriptLine[] = [
  { kind: 'command', text: 'man sentinel' },
  { kind: 'short', text: MAN_HEADER.join(' '), parts: MAN_HEADER },
  BLANK,
  { kind: 'short', text: 'NAME' },
  { kind: 'short', text: MAN_NAME_LINE, indent: true },
  BLANK,
  { kind: 'short', text: 'DESCRIPTION' },
  { kind: 'paragraph', text: SENTINEL_DEFINITION, indent: true },
  BLANK,
  { kind: 'command', text: 'whoami' },
  { kind: 'short', text: ABOUT_NAME },
  { kind: 'paragraph', text: ABOUT_BIO },
  BLANK,
  { kind: 'prompt', text: '' },
];

export type ScriptStep =
  | {
      readonly kind: 'command';
      readonly start: number;
      readonly end: number;
      readonly keyGaps: readonly number[];
      readonly enterPause: number;
    }
  | {
      readonly kind: 'paragraph';
      readonly start: number;
      readonly end: number;
      readonly charMs: number;
    }
  | { readonly kind: 'short' | 'blank' | 'prompt'; readonly start: number; readonly end: number };

/** mulberry32: a tiny seeded generator, so the variation is the same every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rand: () => number, lo: number, hi: number) =>
  lo + Math.floor(rand() * (hi - lo + 1));

/** A short beat before the first key, as a person settles at the keyboard. */
const FIRST_KEY_DELAY = 250;

export function scriptTimeline(script: readonly ScriptLine[] = ABOUT_SCRIPT): {
  steps: ScriptStep[];
  total: number;
} {
  const rand = seeded(0x5e7);
  const steps: ScriptStep[] = [];
  let at = FIRST_KEY_DELAY;
  for (const line of script) {
    if (line.kind === 'command') {
      const keyGaps = [...line.text].map(() => between(rand, 60, 120));
      const enterPause = between(rand, 300, 500);
      const end = at + keyGaps.reduce((n, gap) => n + gap, 0) + enterPause;
      steps.push({ kind: 'command', start: at, end, keyGaps, enterPause });
      at = end;
    } else if (line.kind === 'paragraph') {
      const charMs = between(rand, 15, 25);
      const end = at + line.text.length * charMs;
      steps.push({ kind: 'paragraph', start: at, end, charMs });
      at = end;
    } else {
      steps.push({ kind: line.kind, start: at, end: at });
    }
  }
  return { steps, total: at };
}

/**
 * How many characters of a line are showing `t` ms after playback began, or
 * -1 when the line has not started. A command's prompt shows as soon as it
 * starts, its keys one gap at a time; a short line is whole the moment it
 * starts.
 */
export function shownAt(step: ScriptStep, length: number, t: number): number {
  if (t < step.start) return -1;
  if (step.kind === 'command') {
    let elapsed = t - step.start;
    let keys = 0;
    for (const gap of step.keyGaps) {
      if (elapsed < gap) break;
      elapsed -= gap;
      keys += 1;
    }
    return keys;
  }
  if (step.kind === 'paragraph')
    return Math.min(length, Math.floor((t - step.start) / step.charMs));
  return length;
}
