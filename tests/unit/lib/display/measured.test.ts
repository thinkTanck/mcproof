import {
  MEASURED_CLASSIFICATION,
  MEASURED_CLASSIFICATION_PROVENANCE,
  MEASURED_COMPROMISE,
  MEASURED_COMPROMISE_PROVENANCE,
} from '@/eval/measured';
import {
  classificationDisplayProvenance,
  compromiseDisplayProvenance,
  measuredCopy,
  measuredCounts,
} from '@/lib/display/measured';

/**
 * THE MEASURED FIGURES AS A PERSON READS THEM (copy pass, 2026-10-15).
 *
 * The provenance lines in `src/eval/measured.ts` are frozen and stay verbatim
 * in code. On screen they read in plain words, with the measurement day in UTC
 * (the passes ran 00:52 to 01:16 UTC on Aug 24, 2026, the evening of Aug 23 in
 * US Central time). Every count is DERIVED from the frozen constants: no
 * number here may be typed by hand where a constant holds it.
 */
describe('the display provenance lines', () => {
  it('read the compromise line in plain words, the day in UTC', () => {
    expect(compromiseDisplayProvenance()).toBe(
      'measured Aug 24, 2026 (UTC) · 51 test runs · graded 5 times each · detector claude-haiku-4-5',
    );
  });

  it('read the classification line in plain words, the day in UTC', () => {
    expect(classificationDisplayProvenance()).toBe(
      'attack type measured Aug 24, 2026 (UTC) · 22 compromised test runs · graded 5 times each · detector claude-haiku-4-5',
    );
  });

  it('take every value from the frozen lines, not from a second copy', () => {
    const n = /N=(\d+)/.exec(MEASURED_COMPROMISE_PROVENANCE)![1];
    const judge = /judge (\S+)/.exec(MEASURED_COMPROMISE_PROVENANCE)![1];
    const passes = /(\d+) passes/.exec(MEASURED_COMPROMISE_PROVENANCE)![1];
    expect(compromiseDisplayProvenance()).toContain(`${n} test runs`);
    expect(compromiseDisplayProvenance()).toContain(`graded ${passes} times each`);
    expect(compromiseDisplayProvenance()).toContain(`detector ${judge}`);
    expect(classificationDisplayProvenance()).toContain(
      `${MEASURED_CLASSIFICATION.scored} compromised test runs`,
    );
    expect(MEASURED_CLASSIFICATION_PROVENANCE).toContain(`n=${MEASURED_CLASSIFICATION.scored}`);
  });
});

describe('the counts behind the figures', () => {
  it('are derived from the measured rates and the scored denominator', () => {
    const tp = MEASURED_CLASSIFICATION.scored;
    expect(measuredCounts()).toEqual({
      runs: 51,
      passes: 5,
      flagged: Math.round(tp / MEASURED_COMPROMISE.precision),
      flaggedReal: tp,
      real: Math.round(tp / MEASURED_COMPROMISE.recall),
      caught: tp,
      scored: tp,
      namedRight: Math.round(MEASURED_CLASSIFICATION.accuracy * tp),
    });
    // The verified counts (copy pass claim audit): 22 of 23, 22 of 22, 15 of 22.
    expect(measuredCounts()).toMatchObject({ flagged: 23, real: 22, namedRight: 15 });
  });
});

describe('the sentences the metric block reads', () => {
  it('say the approved words, with the counts filled in', () => {
    const copy = measuredCopy();
    expect(copy.intro).toBe(
      'We built 51 test runs where we already knew which ones were compromised. On Aug 24, 2026 (UTC), the detector graded each run five times, and we kept the answer it gave most often. On every run, all five grades matched.',
    );
    expect(copy.precision).toBe('It flagged 23 runs as compromised, and 22 of them were.');
    expect(copy.recall).toBe('It caught all 22 real compromises.');
    expect(copy.classification).toBe(
      'For those 22 compromises, it named the right attack type (which of the 7 risks it was) 15 times.',
    );
    expect(copy.precisionLabel).toBe('22 of 23');
    expect(copy.recallLabel).toBe('22 of 22');
    expect(copy.classificationLabel).toBe('15 of 22');
    expect(copy.condition).toBe(
      'These numbers apply only to this exact detector: the same grading instructions, the same model (claude-haiku-4-5) and the same settings. If any of those change, we have to measure again before the numbers count.',
    );
  });

  it('use no em dashes', () => {
    for (const text of Object.values(measuredCopy())) expect(text).not.toMatch(/—/);
  });
});

describe('derivation, proven by changing the constants', () => {
  afterEach(() => {
    vi.doUnmock('@/eval/measured');
    vi.resetModules();
  });

  it('moves every count and date when the frozen values move', async () => {
    vi.resetModules();
    vi.doMock('@/eval/measured', () => ({
      MEASURED_COMPROMISE: { precision: 0.9, recall: 0.9 },
      MEASURED_COMPROMISE_PROVENANCE:
        'measured · N=60 labeled realizations · 3 passes · 2026-09-02 · judge some-model',
      MEASURED_CLASSIFICATION: { accuracy: 0.5, scored: 18 },
      MEASURED_CLASSIFICATION_PROVENANCE:
        'category accuracy · n=18 scored · 3 passes · 2026-09-02 · judge some-model',
    }));
    const m = await import('@/lib/display/measured');
    expect(m.compromiseDisplayProvenance()).toBe(
      'measured Sep 2, 2026 (UTC) · 60 test runs · graded 3 times each · detector some-model',
    );
    expect(m.classificationDisplayProvenance()).toBe(
      'attack type measured Sep 2, 2026 (UTC) · 18 compromised test runs · graded 3 times each · detector some-model',
    );
    const copy = m.measuredCopy();
    expect(copy.precision).toBe('It flagged 20 runs as compromised, and 18 of them were.');
    expect(copy.recall).toBe('It caught 18 of 20 real compromises.');
    expect(copy.classification).toMatch(/^For those 18 compromises, .* 9 times\.$/);
    expect(copy.intro).toContain('graded each run three times');
    expect(copy.condition).toContain('(some-model)');
  });
});
