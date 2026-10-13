'use client';

import { cn } from '@/lib/utils';
import type { Step } from '@/contract';
import { stepMeta, stepPayload } from './step-meta';

/**
 * The step-detail / payload panel. Its OUTER height is FIXED (sized to the
 * tallest step) and the payload scrolls INSIDE, so advancing the playhead never
 * reflows the page — the "jumps up and down" failure mode. Observable payload
 * only (args / result / content / memory key+value / summary); never GroundTruth.
 */
export function StepDetail({
  step,
  index,
  compromised,
}: {
  step: Step;
  index: number;
  compromised: boolean;
}) {
  const meta = stepMeta(step.type);
  const rows = stepPayload(step);
  return (
    <section
      aria-label="Step detail"
      aria-live="polite"
      className="flex h-[188px] flex-col overflow-hidden rounded-lg border border-line bg-panel"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
        <span className="font-mono text-[13px] tabular-nums text-ink-faint">
          {String(index + 1).padStart(2, '0')}
        </span>
        <span
          className={cn(
            'font-mono text-[13px] uppercase tracking-[0.1em]',
            compromised
              ? 'text-breach-text'
              : meta.band === 'nominal'
                ? 'text-nominal'
                : meta.band === 'caution'
                  ? 'text-caution'
                  : 'text-ink-muted',
          )}
        >
          {compromised ? `${meta.tag} · BREACH` : meta.tag}
        </span>
        <span className="reading text-ink">{meta.label}</span>
      </header>
      {/* Focusable + labelled so a keyboard user can scroll a long payload
          (several steps overflow the fixed 188px height): scrollable-region-focusable. */}
      <dl
        aria-label="Step payload"
        tabIndex={0}
        className="grid min-h-0 flex-1 grid-cols-[minmax(5.5rem,max-content)_minmax(0,1fr)] content-start gap-3 overflow-y-auto px-4 py-3 focus-inside"
      >
        {rows.map((row) => (
          <div key={row.k} className="contents">
            <dt className="font-mono text-[13px] uppercase tracking-[0.08em] text-ink-faint">
              {row.k}
            </dt>
            <dd className="min-w-0">
              <pre className="whitespace-pre-wrap break-words font-mono text-[15px] leading-relaxed text-readout">
                {row.v}
              </pre>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
