import Link from 'next/link';
import { CORE7 } from './core7';

/**
 * The Core-7 as a "pick a sample" launcher — one row per category, each a link to
 * watch that category's own sample attack replay. `runHref` maps a category id to
 * its sample run route (the featured ASI02 row points at `/runs/sample`).
 *
 * Type roles: the ASI id is INSTRUMENT (mono, `.instrument`); the category title
 * is a SECONDARY sans label (a name, not prose); the big numeral is a sans
 * display glyph. No running prose lives here, so nothing is prose-in-instrument.
 */
export function Core7List({ runHref }: { runHref: (id: string) => string }) {
  return (
    <nav aria-label="Core-7 sample runs" className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="micro-label !tracking-[0.16em] text-nominal">
          The Core-7 · pick a sample
        </span>
        <span className="instrument-faint hidden sm:inline">Tap to watch</span>
      </div>
      <ul className="flex flex-col">
        {CORE7.map((c) => (
          <li key={c.id}>
            <Link
              href={runHref(c.id)}
              aria-label={`Watch the ${c.id} ${c.title} sample attack`}
              className="group flex min-h-11 items-center gap-3 rounded-md border border-transparent px-2 py-2.5 transition-colors hover:border-line hover:bg-nominal/[0.06]"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-nominal shadow-glow-nominal"
              />
              <span className="min-w-[28px] font-sans text-lg font-semibold text-ink-hi tabular-nums">
                {c.num}
              </span>
              <span className="min-w-0 flex-1">
                {/* One line by contract (an ASI code never wraps), inside a link row
                    whose height it sets: `one-line` keeps the row its size. */}
                <span className="instrument one-line block">{c.id}</span>
                <span className="block font-sans text-[14px] text-ink">{c.title}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 font-mono text-[13px] tracking-[0.08em] text-nominal">
                Watch
                <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d="M2 6h7M6 3l3 3-3 3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
