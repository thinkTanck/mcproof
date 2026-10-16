import { SAMPLE_VERDICT_PROVENANCE } from '@/data/fixtures/sample-verdicts';
import {
  SAMPLE_TRACE_CONSTRUCTED,
  humanDate,
  LIVE_GRADED_BY,
  liveDisplayProvenance,
  localDate,
  localDateTime,
  sampleDates,
  sampleDisplayProvenance,
  stepLabel,
  withStepNumber,
} from '@/lib/display/dates';

/**
 * Dates and labels (owner rulings 2026-10-14). A date a person reads looks like
 * "Aug 5, 2026" and says what it is the date OF; data, exports and provenance
 * in code keep ISO. A step is "#N", never its trace id.
 */
describe('humanDate', () => {
  it.each([
    ['2026-08-05', 'Aug 5, 2026'],
    ['2026-10-14T14:14:03.120Z', 'Oct 14, 2026'],
    ['2026-01-31', 'Jan 31, 2026'],
    ['2026-12-01T23:59:59Z', 'Dec 1, 2026'],
  ])('%s reads %s', (iso, human) => {
    expect(humanDate(iso)).toBe(human);
  });

  it('is the UTC day, so it does not move with the reader’s time zone', () => {
    expect(humanDate('2026-10-14T23:30:00Z')).toBe('Oct 14, 2026');
    expect(humanDate('2026-10-15T00:30:00+02:00')).toBe('Oct 14, 2026');
  });

  it('answers null for a value that is not a date', () => {
    expect(humanDate('not a date')).toBeNull();
    expect(humanDate('')).toBeNull();
  });
});

describe('a sample says when it was constructed and when its verdict was recorded', () => {
  it('reads one phrase, "constructed and judged <date>", when both are the same day', () => {
    const line = sampleDisplayProvenance();
    expect(line).toBe(
      'constructed demonstration · constructed and judged Aug 5, 2026 · detector claude-haiku-4-5',
    );
    expect(line).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('keeps the two-part form only when the days differ', () => {
    expect(sampleDates('2026-07-30', '2026-08-05')).toBe(
      'constructed Jul 30, 2026 · verdict recorded Aug 5, 2026',
    );
    expect(sampleDates('2026-08-05', '2026-08-05T15:00:00Z')).toBe(
      'constructed and judged Aug 5, 2026',
    );
  });

  it('takes the recording date from the frozen provenance line, which stays ISO', () => {
    expect(SAMPLE_VERDICT_PROVENANCE).toMatch(/· 2026-08-05$/);
  });

  it('takes the construction date from the git history of the sample sources', () => {
    // 9bcc728 (2026-08-05) is the last commit that changed any sample trace:
    // it retyped the inbound turn in all seven (ADR-0011).
    expect(SAMPLE_TRACE_CONSTRUCTED).toBe('2026-08-05');
  });
});

describe('a live run says the day it ran', () => {
  it('reads "run <date>" and names the detector that graded it', () => {
    // The server's text, with the UTC day. On screen the date is drawn again in
    // the viewer's own zone (`LocalDate`).
    expect(liveDisplayProvenance('2026-10-14T14:14:03Z')).toBe(
      'live run · run Oct 14, 2026 · graded by the MCProof detector',
    );
    expect(LIVE_GRADED_BY).toBe('graded by the MCProof detector');
  });

  it('drops a date it cannot read rather than print a wrong one', () => {
    expect(liveDisplayProvenance('garbage')).toBe('live run · graded by the MCProof detector');
  });
});

/**
 * A RUN DATE IS THE VIEWER'S DAY (owner ruling 2026-10-15). A run at 7:37 PM
 * CDT on Oct 15 is 00:37 UTC on Oct 16, and the UTC day told its owner it ran
 * the next day. The data keeps ISO UTC; only the words on screen move.
 */
describe("localDate: the day in the viewer's own time zone", () => {
  it('reads the Chicago day for a run late in the Chicago evening', () => {
    expect(localDate('2026-10-16T00:37:00Z', 'America/Chicago')).toBe('Oct 15, 2026');
    expect(localDate('2026-10-16T00:37:00Z', 'UTC')).toBe('Oct 16, 2026');
  });

  it('moves east of UTC as well', () => {
    expect(localDate('2026-12-31T20:00:00Z', 'Asia/Tokyo')).toBe('Jan 1, 2027');
  });

  it('answers null for a value that is not a date', () => {
    expect(localDate('nope', 'America/Chicago')).toBeNull();
    expect(localDate('', 'America/Chicago')).toBeNull();
  });
});

describe('a moment in the viewer’s own time', () => {
  it('reads "Oct 14, 2026, 1:31 PM CDT" in the given zone', () => {
    expect(localDateTime('2026-10-14T18:31:00Z', 'America/Chicago')).toBe(
      'Oct 14, 2026, 1:31 PM CDT',
    );
    expect(localDateTime('2026-01-05T09:05:00Z', 'America/New_York')).toBe(
      'Jan 5, 2026, 4:05 AM EST',
    );
  });

  it('answers null for a value that is not a time', () => {
    expect(localDateTime('never', 'America/Chicago')).toBeNull();
  });
});

describe('a step is "#N"', () => {
  it('labels by position', () => {
    expect(stepLabel(2)).toBe('#2');
  });

  it('turns the summary’s trace id into the step number, and nothing else', () => {
    expect(
      withStepNumber('Compromised: ASI02, severity Critical. Offending step: s2.', 's2', 2),
    ).toBe('Compromised: ASI02, severity Critical. Offending step: #2.');
    // A summary with no such phrase is printed as it was written.
    expect(withStepNumber('Not compromised.', 's2', 2)).toBe('Not compromised.');
    // The withheld summary's shorter phrase too (copy pass, 2026-10-15).
    expect(withStepNumber('Compromised, severity High. Step: s5. The detector', 's5', 5)).toBe(
      'Compromised, severity High. Step: #5. The detector',
    );
    // Only the offending step's own id, never another that shares its prefix.
    expect(withStepNumber('Offending step: s12.', 's1', 1)).toBe('Offending step: s12.');
  });
});
