'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * ONE-SHOT REVEAL ON SCROLL, for the /about page (owner ruling 2026-10-18).
 *
 * The server sends every animated part in a PENDING state, and CSS resolves
 * pending to the finished picture under reduced motion or with no script
 * (globals.css, "/about motion"), so nothing is drawn finished and then
 * redrawn. With motion allowed, the part starts once it is first scrolled into
 * view, and never again. Reduced motion skips straight to done.
 */
export type RevealState = 'pending' | 'running' | 'done';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const reducedNow = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(QUERY).matches;

/**
 * Reduced motion, as the browser says it, and FALSE on the server. The shared
 * hook answers true on the server, which here would send the finished text and
 * then retype it after hydration: the flash the owner ruled out. On this page
 * the server always sends pending, and CSS resolves pending to the finished
 * picture under reduced motion before any script runs.
 */
function usePrefersReducedMotionAfterMount(): boolean {
  return useSyncExternalStore(subscribe, reducedNow, () => false);
}

export function useRevealOnView<T extends Element>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const reduced = usePrefersReducedMotionAfterMount();
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (reduced || started) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setStarted(true);
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [reduced, started, threshold]);

  return { ref, reduced, started };
}
