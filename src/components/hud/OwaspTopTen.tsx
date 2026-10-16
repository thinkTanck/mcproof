import Link from 'next/link';
import { THREATS } from '@/components/threats/threat-data';

/** What the badge says, everywhere it is drawn. */
export const OWASP_BADGE_LABEL = 'Maps to OWASP Agentic Top 10';
/** Where the claim is spelled out: which of the ten are tested and which are not. */
export const OWASP_COVERAGE_HREF = '/threats';
/** The question the explanation answers. */
export const OWASP_EXPLAINER_QUESTION = 'What is the OWASP Agentic Top 10?';

/**
 * "MAPS TO OWASP AGENTIC TOP 10", as words (UI audit 2026-10-12, batch C).
 *
 * A text badge and nothing else: no logo, no mark that imitates OWASP's, no
 * icon. It is an INSTRUMENT label in the inert line tone, never a status
 * colour, because it states what the product is organised around and is not a
 * reading of anything.
 *
 * "Maps to" is the honest verb. The product tests some of the ten and marks
 * the rest not measurable, so the badge is a link to the coverage board, where
 * that is stated category by category, and nothing beside it claims all ten.
 *
 * The link's own box is at least `--target-min` each way; the pill inside it
 * is the part that is drawn.
 */
export function OwaspBadge() {
  return (
    <Link
      href={OWASP_COVERAGE_HREF}
      data-testid="owasp-badge"
      className="micro-label group target-min inline-flex items-center"
    >
      <span className="rounded-full border border-line px-2.5 py-1 group-hover:border-line-em">
        {OWASP_BADGE_LABEL}
      </span>
    </Link>
  );
}

/**
 * WHAT "OWASP AGENTIC TOP 10" MEANS, one press away (UI audit 2026-10-12,
 * batch C; WCAG 3.1.3, 3.1.4).
 *
 * A native `<details>`: it opens with Enter, with Space and with a tap, the
 * browser reports whether it is open, and it needs no script. It is not a
 * hover tooltip and has no `title`. Closed, it is one line; open, its text is
 * drawn below the summary, so nothing above it moves. It adds no live region.
 *
 * The counts are read from the coverage board's own data, so this sentence
 * cannot say seven while the board says something else.
 */
export function OwaspExplainer({ className }: { className?: string }) {
  const covered = THREATS.filter((threat) => threat.state === 'covered').length;
  const inert = THREATS.length - covered;
  return (
    <details data-testid="owasp-explainer" className={`group min-w-0 ${className ?? ''}`.trim()}>
      <summary className="target-min inline-flex cursor-pointer list-none items-center gap-2 font-mono text-[13px] tracking-[0.04em] text-ink [&::-webkit-details-marker]:hidden">
        {/* The state, drawn: the chevron points right when closed and down
            when open. It turns at once, with no transition. */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          aria-hidden="true"
          focusable="false"
          className="shrink-0 group-open:rotate-90"
        >
          <path
            d="M4 2l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="underline-offset-4 group-hover:underline">{OWASP_EXPLAINER_QUESTION}</span>
      </summary>
      <div data-testid="owasp-explainer-body" className="pb-2 pt-1">
        <p className="reading measure text-ink-muted">
          OWASP is a nonprofit that publishes widely used lists of security risks. Its Top 10 for
          Agentic Applications (2026) names the ten most serious risks for AI agents that use tools.
          MCProof tests {covered} of the {THREATS.length}. The other {inert} cannot be seen in a
          single run, and the{' '}
          <Link
            href={OWASP_COVERAGE_HREF}
            className="text-nominal underline underline-offset-4 hover:text-readout"
          >
            Threat Model page
          </Link>{' '}
          explains why.
        </p>
      </div>
    </details>
  );
}
