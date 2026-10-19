import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { StatusChip } from '@/components/hud';
import { InertMark } from '@/components/leaderboard';
import { OWASP_BADGE_LABEL, OWASP_COVERAGE_HREF } from '@/components/hud/OwaspTopTen';
import { THREATS } from '@/components/threats/threat-data';
import { HOW_A_TEST_WORKS } from '@/components/home/HowATestWorks';
import { CORE7 } from '@/components/home/core7';
import { NAV_ITEMS } from '@/components/shell/nav-items';
import {
  classificationDisplayProvenance,
  compromiseDisplayProvenance,
  measuredCopy,
} from '@/lib/display/measured';
import { asiLabel } from '@/lib/owasp/asi';
import {
  CONNECT_CLIENT_TABS,
  CORE7_LIST_LABEL,
  HOW_A_TEST_WORKS_TITLE,
  METRIC_HEADING_CLASSIFICATION,
  METRIC_HEADING_COMPROMISE,
} from '@/lib/site-copy';
import { ROADMAP_LATER, ROADMAP_NEXT } from '@/lib/about/copy';
import { Reveal } from './Reveal';

/**
 * THE ROADMAP BOARD (owner ruling 2026-10-18). Three columns: Shipped (v1),
 * Next (v2), Later (v3).
 *
 * SHIPPED SAYS ONLY WHAT THE SITE ALREADY SAYS. Every card is built from the
 * same constant or function the page it quotes renders, so no number or claim
 * is typed here and none can drift: the coverage count from the board's own
 * data, the measured figures from the frozen measurement, the six setup tabs
 * from Connect's own list.
 *
 * NOTHING PLANNED READS AS SHIPPED. Next and Later wear the inert pill (never
 * cyan, amber or red: they are no status of anything that exists), and each
 * card is the owner's item written as a plan.
 */
type Card = { key: string; title?: { text: string; href: string }; body: ReactNode };

function shippedCards(): Card[] {
  const copy = measuredCopy();
  const covered = THREATS.filter((t) => t.state === 'covered').length;
  const connect = NAV_ITEMS.find((item) => item.href === '/connect')!;
  const report = HOW_A_TEST_WORKS.find((step) => step.id === 'report')!;
  const provenance = (text: string) => (
    <span className="instrument mt-2 block text-ink-muted">{text}</span>
  );
  return [
    {
      key: 'coverage',
      title: { text: OWASP_BADGE_LABEL, href: OWASP_COVERAGE_HREF },
      body: `MCProof tests ${covered} of the ${THREATS.length}.`,
    },
    {
      key: 'compromise',
      title: { text: METRIC_HEADING_COMPROMISE, href: '/' },
      body: (
        <>
          {copy.precision} {copy.recall}
          {provenance(compromiseDisplayProvenance())}
        </>
      ),
    },
    {
      key: 'classification',
      title: { text: METRIC_HEADING_CLASSIFICATION, href: '/' },
      body: (
        <>
          {copy.classification}
          {provenance(classificationDisplayProvenance())}
        </>
      ),
    },
    {
      key: 'connect',
      title: { text: connect.label, href: connect.href },
      body: (
        <span className="instrument block text-ink">
          {CONNECT_CLIENT_TABS.map((tab) => tab.label).join(' · ')}
        </span>
      ),
    },
    {
      key: 'report',
      title: { text: HOW_A_TEST_WORKS_TITLE, href: '/' },
      body: report.text,
    },
    {
      key: 'samples',
      title: { text: CORE7_LIST_LABEL, href: '/runs/sample' },
      body: CORE7.map((entry) => asiLabel(entry.id)).join(' · '),
    },
  ];
}

const plan = (items: readonly string[]): Card[] => items.map((text) => ({ key: text, body: text }));

const COLUMNS: { id: string; pill: string; done: boolean; cards: () => Card[] }[] = [
  { id: 'shipped', pill: 'Shipped (v1)', done: true, cards: shippedCards },
  { id: 'next', pill: 'Next (v2)', done: false, cards: () => plan(ROADMAP_NEXT) },
  { id: 'later', pill: 'Later (v3)', done: false, cards: () => plan(ROADMAP_LATER) },
];

function InertPill({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[13px] uppercase tracking-[0.12em]"
      style={{
        color: 'var(--status-inert)',
        borderColor: 'color-mix(in srgb, var(--status-inert) 45%, transparent)',
      }}
    >
      <InertMark />
      {label}
    </span>
  );
}

export function Roadmap() {
  let order = 0;
  return (
    <Reveal name="roadmap" className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
      {COLUMNS.map((column) => (
        <section
          key={column.id}
          data-roadmap-column={column.id}
          aria-label={column.pill}
          className="min-w-0"
        >
          <p data-pill="" className="mb-3">
            {column.done ? (
              <StatusChip state="nominal" label={column.pill} />
            ) : (
              <InertPill label={column.pill} />
            )}
          </p>
          <ul className="flex flex-col gap-3">
            {column.cards().map((card) => (
              <li
                key={card.key}
                data-roadmap-card=""
                className="roadmap-card reading rounded-lg border border-line bg-panel px-4 py-3 text-ink"
                style={{ '--i': order++ } as CSSProperties}
              >
                {card.title ? (
                  <Link
                    href={card.title.href}
                    className="micro-label target-min mb-1 flex items-center text-nominal underline underline-offset-4"
                  >
                    {card.title.text}
                  </Link>
                ) : null}
                {card.body}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Reveal>
  );
}
