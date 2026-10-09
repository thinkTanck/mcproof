'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/lib/hud/reduced-motion';

// sessionStorage, not localStorage: the boot splash shows once PER SESSION/TAB —
// a returning-in-the-same-tab reload skips it, but a fresh visit (new tab, new
// session) sees it again.
const SEEN_KEY = 'mcproof.boot.v1.seen';

/**
 * The Core-7 signatures as radar contacts. Angles (deg from top, clockwise) +
 * radius (% of the scope) scatter them but keep the field balanced; index order
 * follows the sweep so they lock in sequence as it passes. Deterministic (no
 * random), so it is stable across renders.
 */
const CONTACTS = [
  { code: 'ASI01', ang: 22, r: 33 },
  { code: 'ASI02', ang: 68, r: 21 },
  { code: 'ASI03', ang: 118, r: 37 },
  { code: 'ASI04', ang: 162, r: 27 },
  { code: 'ASI05', ang: 208, r: 18 },
  { code: 'ASI06', ang: 262, r: 35 },
  { code: 'ASI10', ang: 314, r: 25 },
].map((c) => {
  const a = ((c.ang - 90) * Math.PI) / 180;
  return { ...c, left: 50 + c.r * Math.cos(a), top: 50 + c.r * Math.sin(a) };
});
const N = CONTACTS.length;

type Stage = 'sweep' | 'online' | 'gone';

/**
 * First-visit boot splash — a radar target-lock. A fade-OVER reveal, not a gate:
 * it mounts only after hydration (absent from SSR) so Home paints underneath and
 * LCP is never blocked. A sweep rotates the scope and ACQUIRES the Core-7
 * signatures one by one (each contact locks with a bracket + code), the readout
 * counts up to 7/7, then SYSTEM ONLINE + hold -> the overlay eases away to Home.
 * Skippable (SKIP / any key / click). `prefers-reduced-motion` jumps to the
 * all-locked end frame and fades fast. CYAN ONLY — a boot screen is nominal.
 * Shown once per session/tab (sessionStorage), then flagged. SVG + CSS only, no WebGL.
 */
export function BootSplash() {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(false);
  const [locked, setLocked] = useState(0); // contacts acquired so far
  const [stage, setStage] = useState<Stage>('sweep');
  const [fading, setFading] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    timers.current.forEach(clearTimeout);
    setFading(true);
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* storage blocked -> still dismiss for this session */
    }
    setTimeout(() => setStage('gone'), 420);
  };

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === '1';
    } catch {
      seen = false;
    }
    if (seen) return; // not first visit -> never shows, Home is untouched
    const list = timers.current;
    const push = (fn: () => void, ms: number) => list.push(setTimeout(fn, ms));

    // Kick when the browser is IDLE (after Home's critical render + LCP).
    const kick = () => {
      setActive(true);
      if (reduced) {
        setLocked(N);
        setStage('online');
        push(finish, 900);
      } else {
        CONTACTS.forEach((_, i) => push(() => setLocked(i + 1), 700 + i * 240));
        push(() => setStage('online'), 700 + N * 240 + 140);
        push(finish, 700 + N * 240 + 800);
      }
    };
    let idle = 0;
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(kick, { timeout: 1600 });
    } else {
      list.push(setTimeout(kick, 300));
    }
    return () => {
      if (idle && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      list.forEach(clearTimeout);
    };
  }, [reduced]);

  // Skip on any key or click. Keydown + SKIP are immediate; the click-anywhere
  // skip is armed ~600ms in so a stray early tap does not cut the intro. A Tab
  // press also dismisses, so focus can never wander to Home behind the overlay.
  useEffect(() => {
    if (!active || stage === 'gone') return;
    const skip = () => finish();
    window.addEventListener('keydown', skip);
    // A deliberate tap or scroll means "let me read Home now" — armed ~600ms in so
    // a stray early gesture does not cut the intro.
    const arm = setTimeout(() => {
      window.addEventListener('pointerdown', skip);
      window.addEventListener('wheel', skip, { passive: true });
      window.addEventListener('touchmove', skip, { passive: true });
    }, 600);
    return () => {
      clearTimeout(arm);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('wheel', skip);
      window.removeEventListener('touchmove', skip);
    };
  }, [active, stage]);

  if (!active || stage === 'gone') return null;

  const online = stage === 'online';

  return (
    <div
      role="status"
      aria-label="MCProof booting"
      aria-live="off"
      className={cn(
        'fixed inset-0 z-[100] flex flex-col items-center justify-center bg-base transition-opacity duration-[400ms] ease-out',
        fading ? 'opacity-0' : 'opacity-100 motion-safe:animate-[splash-in_320ms_ease-out]',
      )}
    >
      {/* Radar scope */}
      <div className="relative aspect-square" style={{ width: 'min(90vw, 400px)' }}>
        {/* Range rings + crosshair graticule. */}
        <svg viewBox="0 0 300 300" aria-hidden="true" className="absolute inset-0 h-full w-full">
          <g fill="none" stroke="var(--line)">
            <circle cx="150" cy="150" r="146" />
            <circle cx="150" cy="150" r="106" stroke="var(--line-emphasis)" opacity="0.5" />
            <circle cx="150" cy="150" r="66" stroke="var(--line-emphasis)" opacity="0.4" />
            <circle cx="150" cy="150" r="26" stroke="var(--line-emphasis)" opacity="0.35" />
            <line x1="4" y1="150" x2="296" y2="150" stroke="var(--line-emphasis)" opacity="0.25" />
            <line x1="150" y1="4" x2="150" y2="296" stroke="var(--line-emphasis)" opacity="0.25" />
          </g>
          <circle cx="150" cy="150" r="2.4" fill="var(--status-nominal)" />
        </svg>

        {/* Rotating sweep wedge — clipped to the scope circle. */}
        <div className="absolute inset-0 overflow-hidden rounded-full">
          <div
            aria-hidden="true"
            className={cn(
              'absolute inset-0 rounded-full',
              !reduced && 'motion-safe:animate-[spin_2400ms_linear_infinite]',
            )}
            style={{
              background:
                'conic-gradient(from -6deg, color-mix(in srgb, var(--status-nominal) 26%, transparent), transparent 48deg)',
              opacity: online ? 0.35 : 0.7,
              transition: 'opacity 400ms ease-out',
            }}
          />
        </div>

        {/* Contacts — lock in sequence as the sweep passes. */}
        {CONTACTS.map((c, i) => {
          const isLocked = i < locked;
          return (
            <div
              key={c.code}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
              style={{ left: `${c.left}%`, top: `${c.top}%` }}
            >
              <span className="relative flex h-5 w-5 items-center justify-center">
                {/* Lock bracket appears on acquisition. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-[3px] border transition-all duration-200"
                  style={{
                    borderColor: isLocked ? 'var(--status-nominal)' : 'transparent',
                    transform: isLocked ? 'scale(1)' : 'scale(1.6)',
                    opacity: isLocked ? 0.9 : 0,
                  }}
                />
                <span
                  className="h-2.5 w-2.5 rounded-full transition-all duration-200"
                  style={{
                    background: isLocked
                      ? 'var(--status-nominal)'
                      : 'color-mix(in srgb, var(--status-nominal) 28%, transparent)',
                    boxShadow: isLocked ? 'var(--glow-nominal)' : 'none',
                  }}
                />
              </span>
              <span
                className="font-mono text-[14px] tracking-[0.06em] text-nominal transition-opacity duration-200"
                style={{ opacity: isLocked ? 1 : 0 }}
              >
                {c.code}
              </span>
            </div>
          );
        })}
      </div>

      {/* Readout */}
      <div className="mt-8 flex flex-col items-center gap-2.5 text-center font-mono">
        <div className="micro-label text-ink-faint">Target lock · Core-7</div>
        <div className="text-[15px] tracking-[0.14em]">
          {online ? (
            <span className="text-readout">SYSTEM ONLINE</span>
          ) : (
            <>
              <span className="tabular-nums text-readout">{locked}</span>
              <span className="text-ink-faint"> / {N} SIGNATURES ACQUIRED</span>
            </>
          )}
        </div>
      </div>

      {/* One terminal SR announcement — the overlay's aria-live is off so the
          per-lock count does not churn a polite live region; only the end lands. */}
      <span className="sr-only" aria-live="polite">
        {online ? 'MCProof ready. Core-7 signatures locked.' : ''}
      </span>

      <button
        type="button"
        onClick={finish}
        className="mt-8 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line px-3 font-mono text-[12px] uppercase tracking-[0.12em] text-ink-faint transition-colors hover:border-line-em hover:text-ink"
      >
        Skip
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
