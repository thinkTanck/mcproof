/**
 * THE LOGO RING: a faint full ring with one bright arc that turns, drawn beside
 * the MCProof wordmark wherever the lockup appears (the status bar, sign-in, the
 * not-found page). One definition, so the three cannot drift apart again: they
 * did once, when the status bar's ring was enlarged and the other two kept a
 * smaller ring with the old thin arc.
 *
 * It is 34px, and keeps 30px below 360px, where a run screen's header has 5px to
 * spare (#178). The arc is two units thick and 14 long on a ring 56.55 round
 * (r = 9), with a gap that completes exactly one lap: one arc, about a quarter of
 * the ring, and no second stub where a shorter pattern used to repeat. One turn
 * takes 13s; the global reduced-motion rule stops it.
 *
 * Decoration: the link it sits in carries the name, so the ring is hidden from
 * assistive technology. No client JS.
 */
/**
 * The ring's geometry, in its 24-unit box, as attribute values. The ring below
 * and the link preview card both read it, so the two are one ring.
 */
export const LOGO_RING = {
  viewBox: '0 0 24 24',
  center: '12',
  radius: '9',
  trackWidth: '1',
  arcWidth: '2',
  arcDash: '14 42.55',
  hubRadius: '2.2',
} as const;

/**
 * The wordmark's two halves: the lead in the high ink, the accent in the
 * nominal cyan. The letters are written here and nowhere else; the lockup
 * below and the link preview card (`src/lib/og/share-card.tsx`, which cannot
 * use these components because its renderer reads no CSS) both draw from it.
 */
export const LOGO_WORDMARK = { lead: 'MC', accent: 'Proof' } as const;

export function LogoRing() {
  return (
    <svg
      width="34"
      height="34"
      viewBox={LOGO_RING.viewBox}
      aria-hidden="true"
      className="h-[30px] w-[30px] shrink-0 animate-[spin_13s_linear_infinite] min-[360px]:h-[34px] min-[360px]:w-[34px]"
    >
      <circle
        cx={LOGO_RING.center}
        cy={LOGO_RING.center}
        r={LOGO_RING.radius}
        fill="none"
        stroke="var(--line-emphasis)"
        strokeWidth={LOGO_RING.trackWidth}
      />
      <circle
        cx={LOGO_RING.center}
        cy={LOGO_RING.center}
        r={LOGO_RING.radius}
        fill="none"
        stroke="var(--status-nominal)"
        strokeWidth={LOGO_RING.arcWidth}
        strokeLinecap="round"
        strokeDasharray={LOGO_RING.arcDash}
      />
      <circle
        cx={LOGO_RING.center}
        cy={LOGO_RING.center}
        r={LOGO_RING.hubRadius}
        fill="var(--status-nominal)"
      />
    </svg>
  );
}

/**
 * THE LOCKUP: the ring and the MCProof wordmark beside it, as one mark. Every
 * screen that shows the logo renders this inside its own home link, so the link
 * keeps its own spacing and the mark inside it is identical everywhere. The
 * wordmark was written out three times and had drifted to 21px in the status bar
 * and 20px on sign-in and the not-found page; it is 21px, here, once.
 *
 * Below 360px it drops its letter-spacing, the way the ring drops to 30px: MCProof
 * is two letters longer than the old name, and at 320 a run screen's header has no
 * room for 0.09em on seven letters beside the mode chip.
 */
export function LogoLockup() {
  return (
    <>
      <LogoRing />
      <span className="font-mono text-[21px] font-semibold tracking-[0em] text-ink-hi min-[360px]:tracking-[0.09em]">
        {LOGO_WORDMARK.lead}
        <span className="text-nominal">{LOGO_WORDMARK.accent}</span>
      </span>
    </>
  );
}
