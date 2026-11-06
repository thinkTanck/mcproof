/**
 * THE FACTS THE TERMS AND PRIVACY PAGES SHARE (marketing plan 5.11; P0).
 *
 * The operator is the company, Agentrifi (DBA pending), never a personal name.
 * The pages are drafts, pending lawyer review, until Dame approves them: while
 * `LEGAL_STATUS` is 'draft' the branch preview shows a draft line, and the
 * release gate (tests/release/release-blockers.test.ts) refuses a release.
 * Dates are ISO and printed through src/lib/display/dates.ts.
 */

export type LegalStatus = 'draft' | 'approved';

/** Who runs the site and the service. */
export const LEGAL_OPERATOR = 'Agentrifi';

/** Draft until Dame signs the pages off; flipping it is a release blocker (Q3). */
export const LEGAL_STATUS: LegalStatus = 'draft';

/** The day the Terms text last changed. */
export const TERMS_UPDATED = '2026-11-05';

/** The day the Privacy text last changed. */
export const PRIVACY_UPDATED = '2026-11-05';
