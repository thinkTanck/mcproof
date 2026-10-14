import { SAMPLE_VERDICT_PROVENANCE } from '@/data/fixtures/sample-verdicts';

/**
 * DATES AND STEP LABELS AS A PERSON READS THEM (owner rulings, 2026-10-14).
 *
 * A date on screen reads like "Aug 5, 2026" and says what it is the date OF,
 * so a recorded verdict is never read as today's. Data, exports and the
 * provenance lines in code keep ISO: this module only turns them into words at
 * the point they are drawn, and edits nothing it reads (the sample fixtures are
 * frozen).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Aug 5, 2026", from an ISO date or timestamp, or null when it is not one. The
 * UTC day, written out by hand rather than through the reader's locale, so the
 * server and the browser print the same words and the date does not move with
 * the time zone.
 */
export function humanDate(iso: string): string | null {
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  if (iso === '' || Number.isNaN(at.getTime())) return null;
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}, ${at.getUTCFullYear()}`;
}

/**
 * The day the sample traces the screens render were constructed, from the git
 * history of their sources: 9bcc728 (2026-08-05) is the last commit that changed
 * any of the seven, when it retyped the inbound turn as `principal_instruction`
 * (ADR-0011). The verdicts were recorded against those traces the same day.
 */
export const SAMPLE_TRACE_CONSTRUCTED = '2026-08-05';

/** The judge and the ISO recording date, read off the frozen provenance line. */
function recordedSample(): { judge: string | null; recorded: string | null } {
  const parts = SAMPLE_VERDICT_PROVENANCE.split(' · ');
  const iso = parts.at(-1) ?? '';
  const judge = parts.find((p) => p.startsWith('claude-')) ?? null;
  return { judge, recorded: humanDate(iso) };
}

/**
 * A sample's label on screen: what it is, when its trace was constructed and
 * when its verdict was recorded, e.g. "constructed demonstration · constructed
 * Aug 5, 2026 · verdict recorded Aug 5, 2026 · judge claude-haiku-4-5".
 */
export function sampleDisplayProvenance(): string {
  const { judge, recorded } = recordedSample();
  const constructed = humanDate(SAMPLE_TRACE_CONSTRUCTED);
  return [
    'constructed demonstration',
    constructed && `constructed ${constructed}`,
    recorded && `verdict recorded ${recorded}`,
    judge && `judge ${judge}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

/** A live run's label on screen: the day it ran. An unreadable date is dropped. */
export function liveDisplayProvenance(createdAt: string): string {
  const day = humanDate(createdAt);
  return ['live run', day && `run ${day}`, 'verdict from the locked validated judge']
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

/** A step as a person counts it: "#2", never its trace id. */
export function stepLabel(index: number): string {
  return `#${index}`;
}

/**
 * The fix report's summary names the offending step by its trace id ("Offending
 * step: s2."). On screen that phrase reads as the step number instead. Only that
 * exact phrase is touched; the exported ticket is the generator's own text.
 */
export function withStepNumber(summary: string, stepId: string, index: number): string {
  return summary.replace(`Offending step: ${stepId}.`, `Offending step: ${stepLabel(index)}.`);
}
