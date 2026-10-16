'use client';

import Link from 'next/link';

/**
 * Route-segment error boundary. Next renders this in place of the segment's UI
 * when a Client/Server Component in the tree throws. It bubbles above the HUD
 * shell (there is no error.tsx inside the (hud) group), so it paints its own
 * full-screen frame rather than sitting inside the command deck.
 *
 * Colour: a fault is a SYSTEM state, not a red-team signal. The tri-state
 * cyan/amber/red is reserved for attack outcomes (red = an actual breach), so an
 * app crash wears the neutral `--status-inert` plane (ADR-0003) — never
 * breach-red, which would read as a false alarm in the product's own language.
 * The one cyan note is the recovery action, an affordance and not a status.
 *
 * Accessibility: the panel is a live region (role="alert") so assistive tech
 * announces the fault, and recovery is a single labelled control.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-base px-6 py-16 text-ink">
      {/* Ambient inert glow — calm, not the cyan/red signal plane. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(120% 80% at 50% -10%,color-mix(in srgb,var(--status-inert) 12%,transparent),transparent 55%)',
        }}
      />
      <div
        role="alert"
        className="flex w-full max-w-md flex-col items-start gap-5 rounded-lg border border-line bg-panel p-8"
      >
        <span aria-hidden="true" className="text-inert" style={{ color: 'var(--status-inert)' }}>
          <svg width="34" height="34" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.3" opacity="0.5" />
            <path d="M16 9v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="16" cy="22" r="1.1" fill="currentColor" />
          </svg>
        </span>

        <div className="flex flex-col gap-2">
          <p className="micro-label" style={{ color: 'var(--status-inert)' }}>
            Error
          </p>
          <h2 className="reading-h3 font-semibold text-ink-hi">
            Something went wrong on this page
          </h2>
        </div>

        <p className="reading text-ink-muted">
          An error stopped this page from loading. Your run data is safe. Try again, or go back to
          the home page.
        </p>

        {error.digest ? (
          <p className="font-mono text-[13px] text-ink-faint">
            Reference <span className="text-readout">{error.digest}</span>
          </p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 items-center rounded-md border border-line-em bg-nominal/10 px-4 font-mono text-[13px] tracking-[0.06em] text-ink transition-colors hover:bg-nominal/20"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center font-mono text-[13px] tracking-[0.04em] text-ink transition-colors hover:text-ink-hi"
          >
            Return home →
          </Link>
        </div>
      </div>
    </main>
  );
}
