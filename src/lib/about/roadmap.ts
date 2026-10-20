import { THREATS } from '@/components/threats/threat-data';
import { inWords, measuredCounts } from '@/lib/display/measured';

/**
 * THE ROADMAP CARDS (owner rulings ABOUT FINAL and ABOUT FINAL TITLES,
 * 2026-10-20). Each card is a title and one line, held word for word by
 * `tests/unit/app/about.test.tsx`. Titles have no full stop and fit one line
 * at the narrowest three-column width.
 *
 * SHIPPED QUOTES THE DATA, NEVER A TYPED NUMBER: the coverage count from the
 * coverage board's own list, the catch rate and the false alarms from the
 * frozen measurement (a false alarm is a flag that was not a real compromise:
 * flagged minus correct).
 *
 * NOTHING PLANNED READS AS SHIPPED. Next and Later are written as plans, in
 * the present or future, and link nowhere.
 */
export interface RoadmapCard {
  readonly title: string;
  readonly line: string;
  readonly href?: string;
}

export interface RoadmapColumn {
  readonly id: 'shipped' | 'next' | 'later';
  readonly pill: string;
  readonly done: boolean;
  readonly cards: readonly RoadmapCard[];
}

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

function shippedCards(): RoadmapCard[] {
  const covered = THREATS.filter((t) => t.state === 'covered').length;
  const c = measuredCounts();
  const falseAlarms = c.flagged - c.flaggedReal;
  return [
    {
      title: `${capitalised(inWords(covered))} attack types`,
      line: `${capitalised(inWords(covered))} of the ${inWords(THREATS.length)} OWASP agentic risks, tested live in one proving ground.`,
      href: '/threats',
    },
    {
      title: 'Verdicts you can check',
      line: `Caught ${c.caught} of ${c.real} compromises in our labeled test set, with ${inWords(falseAlarms)} false ${falseAlarms === 1 ? 'alarm' : 'alarms'}. Every verdict points to the exact step.`,
    },
    {
      title: 'Bring your own agent',
      line: 'Claude Code, Copilot, Cursor, Codex and Gemini CLI connect in minutes.',
      href: '/connect',
    },
    {
      title: 'Watch it break',
      line: 'Every step replayed, down to the moment the agent turns.',
      href: '/runs/sample',
    },
  ];
}

const NEXT: readonly RoadmapCard[] = [
  {
    title: 'Any agent, any model',
    line: 'Open-source and smaller models plug in, with first measured results for Copilot, Cursor, Codex and Gemini CLI.',
  },
  { title: 'Two judges, one verdict', line: 'A second detector model cross-checks every call.' },
  { title: 'A private test set', line: 'A private attack set, kept off the public repo.' },
  { title: 'Attack chains', line: 'Several attacks in one session, each building on the last.' },
];

const LATER: readonly RoadmapCard[] = [
  { title: 'MCProof in your CI', line: 'Every agent update tested in CI before it ships.' },
  {
    title: 'Agent versus agent',
    line: 'When your agent trusts another agent, we test that trust.',
  },
  {
    title: 'The full Top 10',
    line: "The three risks one run can't reach, through multi-agent scenarios.",
  },
  {
    title: 'Regression alerts',
    line: 'Scheduled re-tests that catch the update that made your agent easier to trick.',
  },
  { title: 'Live threat feed', line: 'New scenarios as real agent exploits are published.' },
];

export function roadmapColumns(): readonly RoadmapColumn[] {
  return [
    { id: 'shipped', pill: 'Shipped (v1)', done: true, cards: shippedCards() },
    { id: 'next', pill: 'Next (v2)', done: false, cards: NEXT },
    { id: 'later', pill: 'Later (v3)', done: false, cards: LATER },
  ];
}
