'use client';

/**
 * Root/global error boundary. Next renders this only when the root layout itself
 * throws, which replaces the ENTIRE document — so, unlike the segment-level
 * error.tsx, it renders its own <html>/<body>, and the app stylesheet (imported
 * by the replaced root layout) may not be present. This is the one place where
 * inline styles with literal values are the correct, resilient choice: the
 * last-resort screen must render even if no CSS loaded. The literals below are
 * the DTCG primitives (navy-950 #05080b, navy-850 #101823, ink-100 #d3e2ea,
 * ink-500 #708c9e, line #1c2a36, cyan-100 #b6ecf4) stated by hand for that reason.
 *
 * Colour: a crash is a SYSTEM state, not a red-team signal — neutral inert
 * (ink-500), never breach-red, which is reserved for an actual breach.
 *
 * Accessibility: the panel is a live region (role="alert"); recovery is a single
 * labelled control. Not unit-tested (an <html>/<body> component is invalid inside
 * jsdom), so it is verified via typecheck/build.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Plain literal font stacks — global-error replaces the root layout, so the
  // next/font CSS variables (--font-geist-*) are not on this document's <html>
  // and would not resolve. No token references for the same reason.
  const mono = 'ui-monospace, "Geist Mono", SFMono-Regular, Menlo, monospace';
  const sans = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4rem 1.5rem',
          background: '#05080b',
          color: '#d3e2ea',
          fontFamily: sans,
        }}
      >
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '1.25rem',
            width: '100%',
            maxWidth: '28rem',
            padding: '2rem',
            borderRadius: '0.5rem',
            border: '1px solid #1c2a36',
            background: '#101823',
          }}
        >
          <span aria-hidden="true" style={{ color: '#708c9e', lineHeight: 0 }}>
            <svg width="34" height="34" viewBox="0 0 32 32" fill="none">
              <circle
                cx="16"
                cy="16"
                r="13"
                stroke="currentColor"
                strokeWidth="1.3"
                opacity="0.5"
              />
              <path d="M16 9v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="16" cy="22" r="1.1" fill="currentColor" />
            </svg>
          </span>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p
              style={{
                margin: 0,
                fontFamily: mono,
                fontSize: '12px',
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: '#708c9e',
              }}
            >
              System · Critical fault
            </p>
            <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600, color: '#d3e2ea' }}>
              The interface went down
            </h1>
          </div>

          <p style={{ margin: 0, fontSize: '1.0625rem', lineHeight: 1.55, color: '#99b8c7' }}>
            A critical error took down MCProof. Reloading usually clears it. If it persists, the run
            may need to be restarted.
          </p>

          {error.digest ? (
            <p style={{ margin: 0, fontFamily: mono, fontSize: '12px', color: '#6a8798' }}>
              Reference <span style={{ color: '#b6ecf4' }}>{error.digest}</span>
            </p>
          ) : null}

          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 1rem',
              borderRadius: '0.25rem',
              border: '1px solid #2b6b7d',
              background: 'rgba(84,212,230,0.10)',
              fontFamily: mono,
              fontSize: '12px',
              letterSpacing: '0.06em',
              color: '#b6ecf4',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
