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
function recordedSample(): { judge: string | null; recordedIso: string } {
  const parts = SAMPLE_VERDICT_PROVENANCE.split(' · ');
  const judge = parts.find((p) => p.startsWith('claude-')) ?? null;
  return { judge, recordedIso: parts.at(-1) ?? '' };
}

/**
 * When a sample was constructed and when its verdict was recorded. One phrase
 * when they are the same day, "constructed and judged Aug 5, 2026"; the two-part
 * form only when they differ (owner ruling 2026-10-14). An unreadable date is
 * dropped rather than printed wrong.
 */
export function sampleDates(constructedIso: string, recordedIso: string): string {
  const constructed = humanDate(constructedIso);
  const recorded = humanDate(recordedIso);
  if (constructed && constructed === recorded) return `constructed and judged ${constructed}`;
  return [constructed && `constructed ${constructed}`, recorded && `verdict recorded ${recorded}`]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

/**
 * A sample's label on screen: what it is, when it was constructed and judged,
 * and by which judge, e.g. "constructed demonstration · constructed and judged
 * Aug 5, 2026 · judge claude-haiku-4-5".
 */
export function sampleDisplayProvenance(): string {
  const { judge, recordedIso } = recordedSample();
  return [
    'constructed demonstration',
    sampleDates(SAMPLE_TRACE_CONSTRUCTED, recordedIso),
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

/**
 * A moment in the viewer's own time, with its zone: "Oct 14, 2026, 1:31 PM CDT"
 * (owner ruling 2026-10-14, Connect's LAST SEEN). Read in the browser, so the
 * zone is the reader's; `timeZone` is for tests. The ISO value stays in the
 * data and in the `<time>` element's datetime attribute. Null when not a time.
 */
export function localDateTime(iso: string, timeZone?: string): string | null {
  const at = new Date(iso);
  if (iso === '' || Number.isNaN(at.getTime())) return null;
  const text = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(at);
  // ICU puts a narrow no-break space before AM/PM; print a plain one.
  return text.replace(/[  ]/g, ' ');
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
