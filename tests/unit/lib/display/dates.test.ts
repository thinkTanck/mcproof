import { SAMPLE_VERDICT_PROVENANCE } from '@/data/fixtures/sample-verdicts';
import {
  SAMPLE_TRACE_CONSTRUCTED,
  humanDate,
  liveDisplayProvenance,
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
  it('reads "constructed <date> · verdict recorded <date>", in human dates', () => {
    const line = sampleDisplayProvenance();
    expect(line).toBe(
      'constructed demonstration · constructed Aug 5, 2026 · verdict recorded Aug 5, 2026 · judge claude-haiku-4-5',
    );
    expect(line).not.toMatch(/\d{4}-\d{2}-\d{2}/);
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
  it('reads "run <date>"', () => {
    expect(liveDisplayProvenance('2026-10-14T14:14:03Z')).toBe(
      'live run · run Oct 14, 2026 · verdict from the locked validated judge',
    );
  });

  it('drops a date it cannot read rather than print a wrong one', () => {
    expect(liveDisplayProvenance('garbage')).toBe(
      'live run · verdict from the locked validated judge',
    );
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
    // Only the offending step's own id, never another that shares its prefix.
    expect(withStepNumber('Offending step: s12.', 's1', 1)).toBe('Offending step: s12.');
  });
});
