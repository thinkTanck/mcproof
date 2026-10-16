import type { VariantKind } from '@/contract';

/**
 * THE TWO RUNS A USER CAN START, in words a first-time reader can act on.
 *
 * ── THE WIRE VALUES STAY, THE LABELS DO NOT ──
 *
 * `VariantKind` is `'malicious' | 'benign'`, and it stays that on the wire: those
 * are the contract's own names, shared with the labeled realizations the
 * detector's precision and recall were measured on, and renaming them would
 * decouple the screen from the measurement.
 *
 * They are the wrong words to LEAD with. "Benign" is a pathology term, and to a
 * reader meeting it here it reads as a milder attack rather than as a run with no
 * attack in it at all. So the screen says what each run IS: an attack run, or a
 * control run. Our own terms are still stated on the screen, in prose, below the
 * choice rather than on it.
 *
 * ── WHY THE CONTROL EXISTS AT ALL ──
 *
 * [ADR-0003](../../../docs/adr/0003-core-7-scope-and-measurability-bar.md) bar 4:
 * a category ships only if a benign variant can score not-compromised, because
 * without one you can measure recall but never precision. The same asymmetry hits
 * the USER, not just the measurement: an agent that refuses every tool call
 * scores identically to an agent exercising judgment, and one run cannot tell
 * them apart. The control is what makes their result mean something.
 *
 * ── TOOL PARITY IS THE POINT ──
 *
 * Both framings serve an IDENTICAL tool multiset with identical capability. That
 * is not a claim, it is a tested property of the served surface
 * (`tests/unit/harness/server/surfaces.test.ts`, "benign tool-parity"). The copy
 * therefore states it flatly: the control is not a safer sandbox, and a reader
 * who takes it for one has misread it.
 */
export type RunTypeOption = {
  readonly kind: VariantKind;
  /** The INSTRUMENT label. Short, scannable, and never the wire value. */
  readonly label: string;
  /** What the run is, in the fragment that sits beside the label. */
  readonly gloss: string;
};

export const RUN_TYPES: readonly RunTypeOption[] = [
  { kind: 'malicious', label: 'ATTACK RUN', gloss: 'one tool carries the attack' },
  { kind: 'benign', label: 'CONTROL RUN', gloss: 'the same tools, with no attack' },
] as const;

/** The label for one framing, for printing a ticket the server already issued. */
export const RUN_TYPE_LABEL: Record<VariantKind, string> = Object.fromEntries(
  RUN_TYPES.map((option) => [option.kind, option.label]),
) as Record<VariantKind, string>;
