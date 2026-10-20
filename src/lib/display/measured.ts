import {
  MEASURED_CLASSIFICATION,
  MEASURED_CLASSIFICATION_PROVENANCE,
  MEASURED_COMPROMISE,
  MEASURED_COMPROMISE_PROVENANCE,
} from '@/eval/measured';

/**
 * THE MEASURED FIGURES AS A PERSON READS THEM (copy pass, 2026-10-15).
 *
 * The two provenance lines in `src/eval/measured.ts` are frozen and stay
 * verbatim in code ("measured · N=51 labeled realizations · 5 passes ·
 * 2026-08-24 · judge claude-haiku-4-5"). On screen they read in plain words,
 * and the day carries "(UTC)": every pass ran 00:52 to 01:16 UTC on Aug 24,
 * 2026, which is still Aug 23 in US time zones (owner ruling 2026-10-15).
 *
 * EVERY NUMBER HERE IS DERIVED from the frozen constants, never typed by hand:
 * the run count, the passes, the day and the detector model are read off the
 * provenance lines, and the counts behind the rates (22 of 23, 22 of 22, 15 of
 * 22) are worked back from the rates and the scored denominator. The scored
 * denominator is the true positives (the classification figure is scored over
 * true positives only), so flagged = TP / precision and real = TP / recall.
 * `tests/unit/lib/display/measured.test.ts` moves the constants and watches
 * every sentence move with them.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

/** A small count in words ("five"), a larger one in digits. */
export function inWords(n: number): string {
  return WORDS[n] ?? String(n);
}

/** One field of a frozen provenance line, or a loud failure if the shape moved. */
function field(line: string, pattern: RegExp): string {
  const found = pattern.exec(line)?.[1];
  if (found === undefined) throw new Error(`measured provenance line changed shape: ${line}`);
  return found;
}

/**
 * "Aug 24, 2026 (UTC)" from the ISO day on a provenance line. Read from the
 * digits, so no time zone can move it.
 */
function utcDay(line: string): string {
  const [y, m, d] = field(line, /(\d{4}-\d{2}-\d{2})/)
    .split('-')
    .map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}, ${y} (UTC)`;
}

function judge(line: string): string {
  return field(line, /judge (\S+)/);
}

function passes(line: string): number {
  return Number(field(line, /(\d+) passes/));
}

/** The counts behind the published rates, all derived. */
export function measuredCounts() {
  const tp = MEASURED_CLASSIFICATION.scored;
  return {
    runs: Number(field(MEASURED_COMPROMISE_PROVENANCE, /N=(\d+)/)),
    passes: passes(MEASURED_COMPROMISE_PROVENANCE),
    flagged: Math.round(tp / MEASURED_COMPROMISE.precision),
    flaggedReal: tp,
    real: Math.round(tp / MEASURED_COMPROMISE.recall),
    caught: tp,
    scored: tp,
    namedRight: Math.round(MEASURED_CLASSIFICATION.accuracy * tp),
  };
}

/**
 * The compromise line on screen: "measured Aug 24, 2026 (UTC) · 51 test runs ·
 * graded 5 times each · detector claude-haiku-4-5".
 */
export function compromiseDisplayProvenance(): string {
  const line = MEASURED_COMPROMISE_PROVENANCE;
  return [
    `measured ${utcDay(line)}`,
    `${measuredCounts().runs} test runs`,
    `graded ${passes(line)} times each`,
    `detector ${judge(line)}`,
  ].join(' · ');
}

/**
 * The classification line on screen: "attack type measured Aug 24, 2026 (UTC)
 * · 22 compromised test runs · graded 5 times each · detector
 * claude-haiku-4-5". It quotes its OWN denominator, never the run count above.
 */
export function classificationDisplayProvenance(): string {
  const line = MEASURED_CLASSIFICATION_PROVENANCE;
  return [
    `attack type measured ${utcDay(line)}`,
    `${MEASURED_CLASSIFICATION.scored} compromised test runs`,
    `graded ${passes(line)} times each`,
    `detector ${judge(line)}`,
  ].join(' · ');
}

/** The words of the Home metric block, counts filled in from the measurement. */
export function measuredCopy() {
  const c = measuredCounts();
  const times = inWords(c.passes);
  return {
    intro:
      `We built ${c.runs} test runs where we already knew which ones were compromised. ` +
      `On ${utcDay(MEASURED_COMPROMISE_PROVENANCE)}, the detector graded each run ${times} times, ` +
      `and we kept the answer it gave most often. On every run, all ${times} grades matched.`,
    precisionLabel: `${c.flaggedReal} of ${c.flagged}`,
    precision: `It flagged ${c.flagged} runs as compromised, and ${c.flaggedReal} of them were.`,
    recallLabel: `${c.caught} of ${c.real}`,
    recall:
      c.caught === c.real
        ? `It caught all ${c.real} real compromises.`
        : `It caught ${c.caught} of ${c.real} real compromises.`,
    classificationLabel: `${c.namedRight} of ${c.scored}`,
    classification: `For those ${c.scored} compromises, it named the right attack type (which of the 7 risks it was) ${c.namedRight} times.`,
    condition:
      `These numbers apply only to this exact detector: the same grading instructions, ` +
      `the same model (${judge(MEASURED_COMPROMISE_PROVENANCE)}) and the same settings. ` +
      `If any of those change, we have to measure again before the numbers count.`,
  };
}
