import { SAMPLE_VERDICT_PROVENANCE } from '@/data/fixtures/sample-verdicts';

/**
 * DATES AND STEP LABELS AS A PERSON READS THEM (owner rulings, 2026-10-14).
 *
 * A date on screen reads like "Aug 5, 2026" and says what it is the date OF,
 * so a recorded verdict is never read as today's. Data, exports and the
 * provenance lines in code keep ISO: this module only turns them into words at
 * the point they are drawn, and edits nothing it reads (the sample fixtures are
 * frozen).
 *
 * WHOSE DAY (owner ruling 2026-10-15). A recorded date, the day the samples
 * were constructed and judged or the day the detector was measured, is printed
 * as recorded: `humanDate`, the UTC day, the same for every reader. A LIVE
 * RUN'S date is the viewer's own day: `localDate`, drawn in the browser by
 * `LocalDate` (`src/components/hud/LocalDate.tsx`), because a run at 7:37 PM
 * CDT on Oct 15 is 00:37 UTC on Oct 16 and the UTC day told its owner it ran
 * the next day. The server cannot know the reader's zone, so it prints the UTC
 * day and the browser replaces it after hydration. Exports and the copied
 * ticket keep ISO.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Aug 5, 2026", from an ISO date or timestamp, or null when it is not one. The
 * UTC day, written out by hand rather than through the reader's locale, so the
 * server and the browser print the same words and the date does not move with
 * the time zone. For recorded dates (samples, measurements), and as the
 * server's text for a live run's date before the browser draws `localDate`.
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
 * and by which detector, e.g. "constructed demonstration · constructed and judged
 * Aug 5, 2026 · detector claude-haiku-4-5". "Detector" is the one word on screen
 * for the model that grades a run (copy pass, 2026-10-15).
 */
export function sampleDisplayProvenance(): string {
  const { judge, recordedIso } = recordedSample();
  return [
    'constructed demonstration',
    sampleDates(SAMPLE_TRACE_CONSTRUCTED, recordedIso),
    judge && `detector ${judge}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
}

/**
 * "Oct 15, 2026": the day an ISO timestamp falls on in the viewer's own time
 * zone, or null when it is not a time. Read in the browser, so the zone is the
 * reader's; `timeZone` is for tests and for nothing else.
 */
export function localDate(iso: string, timeZone?: string): string | null {
  const at = new Date(iso);
  if (iso === '' || Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Written out with the same month names as `humanDate`, so the server's UTC
  // fallback and the browser's local day read alike.
  return `${MONTHS[part('month') - 1]} ${part('day')}, ${part('year')}`;
}

/** Who graded a live run, as the provenance line says it. */
export const LIVE_GRADED_BY = 'graded by the MCProof detector';

/**
 * A live run's label on screen: the day it ran (the UTC day; the screen draws
 * the viewer's own day over it with `LocalDate`). An unreadable date is dropped.
 */
export function liveDisplayProvenance(createdAt: string): string {
  const day = humanDate(createdAt);
  return ['live run', day && `run ${day}`, LIVE_GRADED_BY]
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
 * step: s2.", or "Step: s2." when the attack type is unreliable). On screen that
 * phrase reads as the step number instead. Only those exact phrases are
 * touched; the exported ticket is the generator's own text.
 */
export function withStepNumber(summary: string, stepId: string, index: number): string {
  return ['Offending step: ', 'Step: '].reduce(
    (text, phrase) => text.replace(`${phrase}${stepId}.`, `${phrase}${stepLabel(index)}.`),
    summary,
  );
}
