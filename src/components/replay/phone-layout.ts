'use client';

import { useSyncExternalStore } from 'react';

/**
 * WHEN THE REPLAY TAKES ITS PHONE LAYOUT (Part D).
 *
 * Narrower than 768px, or a phone held on its side: under 1024px wide and under
 * 500px tall, where the wide layout put Play two terminals down a screen that
 * shows one. From 768px up on anything taller, the replay is exactly main's.
 *
 * This is the same query the `phone:` CSS variant in `src/app/globals.css` is
 * built on, and a unit test holds the two equal. CSS does the layout; this only
 * tells the components which placement of the transport to keep once the
 * browser has answered, and how the terminal follows the current step.
 */
export const PHONE_LAYOUT_QUERY =
  '(max-width: 767.98px), (max-width: 1023.98px) and (max-height: 499.98px)';

/** `unknown` is the server's answer: it cannot see the screen, so it sends both. */
export type ReplayLayout = 'phone' | 'wide' | 'unknown';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mq = window.matchMedia(PHONE_LAYOUT_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getSnapshot(): ReplayLayout {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'wide';
  return window.matchMedia(PHONE_LAYOUT_QUERY).matches ? 'phone' : 'wide';
}

function getServerSnapshot(): ReplayLayout {
  return 'unknown';
}

export function useReplayLayout(): ReplayLayout {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
