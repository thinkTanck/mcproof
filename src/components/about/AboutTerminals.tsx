'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ABOUT_BIO, ABOUT_WHOAMI } from '@/lib/about/copy';
import { SENTINEL_DEFINITION } from '@/lib/replay/roles';
import { TerminalCard } from './TerminalCard';

/**
 * THE TWO /about TERMINALS, AND WHEN EACH TYPES (owner ruling ABOUT REVISION,
 * 2026-10-19). One component holds both, because one rule spans them:
 *
 *  - whoami streams on page load;
 *  - Why Sentinel streams only when it is scrolled to: after a user scroll,
 *    once it is at least 60% in view;
 *  - if it is already 60% in view at load with no scroll, it starts after
 *    whoami finishes;
 *  - never both typing at once: Sentinel always waits for whoami.
 *
 * "At load" is the observer's first report, which a browser makes as soon as
 * it starts watching. Reduced motion and no script are handled by the cards
 * and by CSS: the finished text, at once.
 */
const VISIBLE_ENOUGH = 0.6;

const noSubscription = () => () => {};
/** False in the server render, true once mounted: whoami starts on the client, never in the HTML. */
const useMounted = () =>
  useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

export function AboutTerminals() {
  const mounted = useMounted();
  const sentinelBox = useRef<HTMLDivElement>(null);
  const [whoamiDone, setWhoamiDone] = useState(false);
  const [sentinelEligible, setSentinelEligible] = useState(false);
  const onWhoamiDone = useCallback(() => setWhoamiDone(true), []);

  useEffect(() => {
    const el = sentinelBox.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let firstReport = true;
    let scrolled = false;
    let inView = false;
    const onScroll = () => {
      scrolled = true;
      if (inView) setSentinelEligible(true);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    const observer = new IntersectionObserver(
      (entries) => {
        const ratio = Math.max(...entries.map((entry) => entry.intersectionRatio));
        inView = ratio >= VISIBLE_ENOUGH;
        if (inView && (firstReport || scrolled)) setSentinelEligible(true);
        firstReport = false;
      },
      { threshold: [0, VISIBLE_ENOUGH] },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <>
      <div className="mt-6 max-w-[760px]">
        <TerminalCard
          id="whoami"
          label="whoami"
          command="whoami"
          lines={[
            { kind: 'out', text: ABOUT_WHOAMI },
            { kind: 'out', text: ABOUT_BIO },
          ]}
          start={mounted}
          onDone={onWhoamiDone}
        />
      </div>

      <section aria-labelledby="why-sentinel" className="mt-12">
        <h2 id="why-sentinel" className="reading-h2">
          Why &quot;Sentinel&quot;
        </h2>
        <div ref={sentinelBox} className="mt-4 max-w-[760px]">
          <TerminalCard
            id="sentinel"
            label="man sentinel"
            command="man sentinel"
            lines={[{ kind: 'out', text: SENTINEL_DEFINITION }]}
            start={whoamiDone && sentinelEligible}
          />
        </div>
      </section>
    </>
  );
}
