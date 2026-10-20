import type { CSSProperties } from 'react';
import Link from 'next/link';
import { StatusChip } from '@/components/hud';
import { InertMark } from '@/components/leaderboard';
import { roadmapColumns } from '@/lib/about/roadmap';
import { Reveal } from './Reveal';

/**
 * THE ROADMAP BOARD (owner rulings 2026-10-18 and ABOUT FINAL, 2026-10-20).
 * Three columns: Shipped (v1), Next (v2), Later (v3); each card a title and
 * one line, from `roadmapColumns()` (`src/lib/about/roadmap.ts`), which quotes
 * the site's own data for every number Shipped states.
 *
 * Three columns from 1024px: the narrowest width at which every title holds
 * one line (ABOUT FINAL TITLES), with a balanced wrap as the fallback.
 *
 * NOTHING PLANNED READS AS SHIPPED. Next and Later wear the inert pill (never
 * cyan, amber or red: they are no status of anything that exists).
 */
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
    <Reveal name="roadmap" className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
      {roadmapColumns().map((column) => (
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
            {column.cards.map((card) => (
              <li
                key={card.title}
                data-roadmap-card=""
                className="roadmap-card rounded-lg border border-line bg-panel px-4 py-3"
                style={{ '--i': order++ } as CSSProperties}
              >
                <p
                  data-card-title=""
                  className="reading font-semibold text-ink [text-wrap:balance]"
                >
                  {card.href ? (
                    <Link
                      href={card.href}
                      className="target-area whitespace-nowrap text-ink underline underline-offset-4"
                    >
                      {card.title}
                    </Link>
                  ) : (
                    card.title
                  )}
                </p>
                <p data-card-line="" className="reading mt-1 text-ink-muted">
                  {card.line}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Reveal>
  );
}
