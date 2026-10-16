/**
 * RESULTS.md is the public v1 result writeup, and it must hold to the same
 * provenance standard as the rest of the project: the detector figure it prints
 * has to be the ACTUAL published one, verbatim, not a number retyped by hand that
 * can drift from `src/eval/measured.ts`. These guards are the committed-artifact
 * half of that standard; the finding's per-run evidence lives in the (gitignored)
 * runtime export and reproduces by re-running the harness.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEASURED_COMPROMISE, MEASURED_COMPROMISE_PROVENANCE } from '@/eval/measured';

const root = process.cwd();
const read = (name: string): string => readFileSync(join(root, name), 'utf8');

describe('RESULTS.md', () => {
  it('exists at the repo root and is non-empty', () => {
    expect(read('RESULTS.md').length).toBeGreaterThan(0);
  });

  it('quotes the detector provenance line verbatim from src/eval/measured.ts', () => {
    // The one place the number and its provenance may come from is the published
    // constant. If measured.ts is re-measured, this fails until RESULTS.md follows.
    expect(read('RESULTS.md')).toContain(MEASURED_COMPROMISE_PROVENANCE);
  });

  it('states the measured precision and recall next to their provenance', () => {
    const doc = read('RESULTS.md');
    expect(doc).toContain(MEASURED_COMPROMISE.precision.toFixed(4));
    expect(doc.toLowerCase()).toContain('precision');
    expect(doc.toLowerCase()).toContain('recall');
  });

  it('uses no em dashes (UI/copy constraint)', () => {
    expect(read('RESULTS.md')).not.toContain('—');
  });
});

describe('README', () => {
  it('links to RESULTS.md', () => {
    expect(read('README.md')).toContain('RESULTS.md');
  });
});

/**
 * THE TEST SET IS PUBLIC (license audit, 2026-10-16). The labeled runs and
 * the trap designs are in this repo, so both public documents say so, and
 * say that future held-out data lives outside it.
 */
describe('both documents say the test set is public', () => {
  const SENTENCE =
    'The 51 labeled test runs and the trap designs are public in this repo, so an agent maker could tune an agent against them; future held-out evaluation data will be kept outside the repo.';

  it.each(['README.md', 'RESULTS.md'])('%s carries the sentence', (file) => {
    expect(read(file).replace(/\s+/g, ' ')).toContain(SENTENCE);
  });
});
