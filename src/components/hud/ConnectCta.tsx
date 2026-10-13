import Link from 'next/link';

/** Where the call to action goes, on every page. */
export const CONNECT_CTA_HREF = '/connect';
/** What it says, on every page. */
export const CONNECT_CTA_LABEL = 'Connect your agent';

/**
 * "CONNECT YOUR AGENT", THE SAME CONTROL WHEREVER IT IS DRAWN (UI audit
 * 2026-10-12, batch B).
 *
 * It had four spellings: a bare text link on Home, and a filled, glowing
 * button on the empty leaderboard, the empty account and the discarded-run
 * page, one of them without its arrow. It is one outlined button now: no fill,
 * a solid border in the nominal colour (at least 3:1 against any surface it
 * sits on), the label in the same colour (at least 4.5:1), no glow and no
 * shadow, at least `--target-min` each way. Outlined on purpose: on Home the
 * filled button is "Play sample", and this is the second step, not a rival
 * to the first.
 *
 * The arrow is decoration and is hidden from assistive technology, so the
 * control is named by its words alone.
 *
 * It takes no props: where it sits is the caller's wrapper, so the control
 * itself is identical everywhere. Measured in tests/e2e/buttons-targets-nav-skip.spec.ts.
 */
export function ConnectCta() {
  return (
    <Link
      href={CONNECT_CTA_HREF}
      data-cta="connect-agent"
      className="target-min inline-flex items-center justify-center gap-2 rounded-md border border-nominal bg-transparent px-5 py-2.5 font-mono text-[14px] tracking-[0.06em] text-nominal transition-colors hover:bg-nominal/10 hover:text-readout"
    >
      {CONNECT_CTA_LABEL}
      <span aria-hidden="true">→</span>
    </Link>
  );
}
