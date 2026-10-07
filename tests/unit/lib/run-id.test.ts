import { CategorySchema } from '@/contract';
import { SAMPLE_RUN_ID, sampleRun } from '@/data/source';
import { SAMPLE_RUN_IDS, couldBeRunId, isRowId } from '@/lib/run-id';

/**
 * THE SAMPLE IDS, AS A PLAIN LIST THE MIDDLEWARE CAN IMPORT.
 *
 * The sample library builds each run from its attack module, and the middleware
 * must not import those: they hold the poisoned payloads and the trace builders.
 * So the ids are written out in `@/lib/run-id`, and this test is what keeps that
 * list honest. Add a category, rename a sample run, or change the alias, and it
 * fails until the list says the same thing the library does.
 */
describe('SAMPLE_RUN_IDS', () => {
  it('is exactly the alias plus every sample run the library serves', () => {
    const served = CategorySchema.options.map((category) => sampleRun(category).runId);

    expect([...SAMPLE_RUN_IDS].sort()).toEqual(['sample', ...served].sort());
    expect(new Set(SAMPLE_RUN_IDS).size).toBe(SAMPLE_RUN_IDS.length);
  });

  it('includes the canonical sample under its own id as well as the alias', () => {
    expect(SAMPLE_RUN_IDS).toContain(SAMPLE_RUN_ID);
    expect(SAMPLE_RUN_IDS).toContain('sample');
  });

  it('holds no id shaped like a row id, so the two kinds cannot be confused', () => {
    expect(SAMPLE_RUN_IDS.filter(isRowId)).toEqual([]);
  });
});

describe('isRowId', () => {
  it.each([
    ['00000000-0000-4000-8000-000000000000', true],
    ['3F2B6C1E-8A4D-4C1B-9E57-0A1B2C3D4E5F', true],
    ['00000000-0000-4000-8000-00000000000', false],
    ['00000000-0000-4000-8000-0000000000000', false],
    ['00000000000040008000000000000000', false],
    ['does-not-exist', false],
    ['', false],
    [' 00000000-0000-4000-8000-000000000000', false],
  ])('%j -> %s', (id, expected) => {
    expect(isRowId(id)).toBe(expected);
  });
});

describe('couldBeRunId', () => {
  it('is true for every sample id and for a row id, and for nothing else', () => {
    for (const id of SAMPLE_RUN_IDS) expect(couldBeRunId(id)).toBe(true);
    expect(couldBeRunId('00000000-0000-4000-8000-000000000000')).toBe(true);
    for (const id of ['does-not-exist', 'SAMPLE', 'sample ', '', 'asi02']) {
      expect(couldBeRunId(id), id).toBe(false);
    }
  });
});
