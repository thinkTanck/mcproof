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
export function LogoRing() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-[30px] w-[30px] shrink-0 animate-[spin_13s_linear_infinite] min-[360px]:h-[34px] min-[360px]:w-[34px]"
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--line-emphasis)" strokeWidth="1" />
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="var(--status-nominal)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="14 42.55"
      />
      <circle cx="12" cy="12" r="2.2" fill="var(--status-nominal)" />
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
        MC<span className="text-nominal">Proof</span>
      </span>
    </>
  );
}
