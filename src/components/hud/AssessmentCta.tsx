import Link from 'next/link';

/** Where the call to action goes, on every page. */
export const ASSESSMENT_CTA_HREF = '/assessments';
/** What it says, on every page. */
export const ASSESSMENT_CTA_LABEL = 'Get an expert assessment';

/**
 * "GET AN EXPERT ASSESSMENT", THE SAME CONTROL WHEREVER IT IS DRAWN (P0;
 * marketing plan H4 and Q8).
 *
 * It goes to /assessments and never straight to the booking link, so it is
 * drawn whether or not booking is open. Outlined like ConnectCta: no fill, a
 * solid border in the nominal colour, the label in the main text colour, at
 * least `--target-min` each way, and the accent glow only under the pointer or
 * the keyboard. The arrow is decoration, so the control is named by its words.
 *
 * It takes no props: where it sits is the caller's wrapper.
 */
export function AssessmentCta() {
  return (
    <Link
      href={ASSESSMENT_CTA_HREF}
      data-cta="assessment"
      className="glow-accent target-min inline-flex items-center justify-center gap-2 rounded-md border border-nominal bg-transparent px-5 py-2.5 font-mono text-[14px] tracking-[0.06em] text-ink transition-colors hover:bg-nominal/10 hover:text-readout"
    >
      {ASSESSMENT_CTA_LABEL}
      <span aria-hidden="true">→</span>
    </Link>
  );
}
