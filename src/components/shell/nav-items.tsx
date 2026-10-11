import type { ReactNode } from 'react';

export type NavItem = {
  label: string;
  /**
   * The word the narrow rail (760 to 1099px) shows under the icon, where the full
   * label does not fit. At most eight characters, and always a piece of the
   * accessible name, so what a reader sees is what a voice user says (WCAG 2.5.3).
   */
  short: string;
  href: string;
  matchPrefix: string;
  icon: ReactNode;
  /**
   * A short plain-words purpose, folded into the link's accessible name and its
   * hover title, so a newcomer learns what a route does without clicking. Only the
   * action routes carry one; self-explanatory routes (Home) do not.
   */
  descriptor?: string;
  /**
   * Whether the destination route exists yet. Unbuilt routes are still shown in
   * the deck (per the approved design) but render with prefetch disabled so the
   * shell does not RSC-404 them on load. Each per-screen fan-out PR flips its
   * own item to `available: true`.
   */
  available: boolean;
};

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3 } as const;

/** Command-deck destinations (order per the splice design's navDef). */
export const NAV_ITEMS: NavItem[] = [
  {
    label: 'Home',
    short: 'Home',
    href: '/',
    matchPrefix: '/',
    available: true,
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <g {...stroke}>
          <path d="M2 7l6-5 6 5" />
          <path d="M4 6.2V14h8V6.2" />
        </g>
      </svg>
    ),
  },
  {
    label: 'Connect / Run',
    short: 'Connect',
    href: '/connect',
    matchPrefix: '/connect',
    descriptor: 'point your own agent at an endpoint and run it',
    available: true,
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <g {...stroke}>
          <rect x="2" y="2" width="12" height="12" rx="2" />
          <line x1="2" y1="6" x2="14" y2="6" />
        </g>
      </svg>
    ),
  },
  {
    label: 'Live Replay',
    short: 'Replay',
    href: '/runs/sample',
    matchPrefix: '/runs',
    descriptor: 'watch a recorded attack step by step',
    available: true,
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <polygon points="4,3 13,8 4,13" fill="currentColor" />
      </svg>
    ),
  },
  {
    label: 'Leaderboard',
    short: 'Board',
    href: '/leaderboard',
    matchPrefix: '/leaderboard',
    available: true,
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <g {...stroke}>
          <line x1="3" y1="13" x2="3" y2="8" />
          <line x1="8" y1="13" x2="8" y2="4" />
          <line x1="13" y1="13" x2="13" y2="10" />
        </g>
      </svg>
    ),
  },
  {
    label: 'Findings',
    short: 'Findings',
    // The featured sample alias, so the nav tracks SAMPLE_CATEGORY (ASI02 now)
    // instead of a hardcoded run id that goes stale when the featured run changes.
    href: '/findings/sample',
    matchPrefix: '/findings',
    available: true,
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <g {...stroke}>
          <path d="M4 2h6l3 3v9H4z" />
          <line x1="6" y1="8" x2="11" y2="8" />
          <line x1="6" y1="11" x2="11" y2="11" />
        </g>
      </svg>
    ),
  },
  {
    label: 'Threat Model',
    short: 'Threat',
    href: '/threats',
    matchPrefix: '/threats',
    available: true,
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <g {...stroke}>
          <path d="M8 2l5 2v3.5c0 3-2.1 5-5 6.5-2.9-1.5-5-3.5-5-6.5V4z" />
          <path d="M5.8 8l1.6 1.6L10.4 6.6" />
        </g>
      </svg>
    ),
  },
];

export function isActive(pathname: string, item: NavItem): boolean {
  return item.href === '/' ? pathname === '/' : pathname.startsWith(item.matchPrefix);
}
