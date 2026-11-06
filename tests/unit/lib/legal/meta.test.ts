import { LEGAL_OPERATOR, LEGAL_STATUS, PRIVACY_UPDATED, TERMS_UPDATED } from '@/lib/legal/meta';
import { humanDate } from '@/lib/display/dates';

/**
 * THE FACTS THE LEGAL PAGES SHARE (P0; plan 5.11, Q2 and Q3).
 *
 * The operator is Agentrifi, never a personal name. The pages ship as a draft
 * on the branch preview, and the release gate (tests/release) refuses a
 * release while the status is still 'draft'.
 */

describe('legal meta', () => {
  it('names the operator as Agentrifi', () => {
    expect(LEGAL_OPERATOR).toBe('Agentrifi');
  });

  it('starts as a draft', () => {
    expect(LEGAL_STATUS).toBe('draft');
  });

  it('carries real ISO dates that print as a person reads them', () => {
    for (const iso of [TERMS_UPDATED, PRIVACY_UPDATED]) {
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(humanDate(iso)).not.toBeNull();
    }
  });
});
