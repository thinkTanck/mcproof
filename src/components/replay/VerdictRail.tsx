'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Verdict } from '@/contract';

/**
 * The detector verdict, rendered as a second terminal (same rules as the
 * transcript: bare console, one colour, breach-red for the compromise facts). It
 * prints the verdict summary — outcome, category, severity, offending step — then
 * an interactive `export … ? [y/n]` prompt: `y` opens the report for this run
 * (/findings/[id]); `n` prints `ok` and stays. There is no rationale prose; the
 * summary is the whole of it.
 *
 * WHAT THE PROMPT OFFERS DEPENDS ON WHAT WAS FOUND. A compromise exports a FIX
 * REPORT, because there is something to fix. A clean run exports a RUN RESULT:
 * the same route, the same record, but calling it a fix report would tell the
 * reader their clean run was a failed attempt at one. Both results are
 * first-class, and the noun has to say so.
 *
 * `y` is a real <Link> (accessible name "Export fix report" / "Export run
 * result") so the off-ramp stays keyboard- and screen-reader-operable. While the
 * prompt is still waiting, pressing y/n ANYWHERE answers it (like a real console
 * prompt) — `y` follows the link, `n` prints `ok`.
 */
const CYAN = 'var(--text-readout)';
const BREACH = 'var(--text-breach)';
const PROMPT_COLOR = 'var(--terminal-prompt)';
const PROMPT = 'detector@sentinel:~';

function Row({ k, v, breachValue }: { k: string; v: string; breachValue?: boolean }) {
  return (
    <div className="whitespace-pre-wrap" style={{ color: CYAN }}>
      <span style={{ opacity: 0.85 }}>{k.padEnd(11, ' ')}</span>
      <span style={{ color: breachValue ? BREACH : CYAN }}>{v}</span>
    </div>
  );
}

export function VerdictRail({
  verdict,
  routeId,
  compromiseStepNumber,
  offendingLabel,
}: {
  verdict: Verdict;
  /** The id in the `/runs/[id]` URL, which is the id `/findings/[id]` resolves. */
  routeId: string;
  /** 1-based step number of verdict.stepId, or null if the run is clean. */
  compromiseStepNumber: number | null;
  /** Tool/label of the offending step, e.g. "send_email". */
  offendingLabel?: string;
}) {
  // Built from the ROUTE id, never `verdict.runId`. For a saved live run that is
  // the session's run id, which the findings route cannot resolve, so the link
  // landed every live run on the missing-report state.
  const href = `/findings/${routeId}`;
  const compromised = verdict.compromised;
  const exportLabel = compromised ? 'Export fix report' : 'Export run result';
  const [answered, setAnswered] = useState<null | 'n'>(null);
  const yRef = useRef<HTMLAnchorElement>(null);

  // While the prompt is unanswered, y/n typed anywhere answers it — the way a
  // console prompt captures the next keystroke. `y` clicks the link (no router
  // dependency, so it still renders under test); `n` prints `ok`. Ignore keys
  // aimed at a text field, and stop listening once answered.
  useEffect(() => {
    if (answered !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        yRef.current?.click();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setAnswered('n');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answered]);

  return (
    <aside
      aria-label="Detector verdict"
      className="overflow-y-auto rounded-lg px-4 py-3 font-mono text-[15px] leading-[1.6]"
      style={{ height: 'clamp(280px, 40vh, 460px)', background: 'var(--terminal-bg)', color: CYAN }}
    >
      <div>
        <span style={{ color: PROMPT_COLOR }}>{PROMPT}$</span> verdict --run {verdict.runId}
      </div>
      <Row
        k="outcome"
        v={compromised ? 'COMPROMISED' : 'NOT COMPROMISED'}
        breachValue={compromised}
      />
      <Row k="category" v={verdict.category} />
      <Row k="severity" v={verdict.severity.toUpperCase()} breachValue={compromised} />
      {compromised && compromiseStepNumber !== null && (
        <Row
          k="offending"
          v={`#${compromiseStepNumber}${offendingLabel ? ` ${offendingLabel}` : ''}`}
          breachValue
        />
      )}

      {/* Interactive export prompt — click y/n, or just type it. The noun follows
          the verdict: there is no fix report for a run with nothing to fix. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-1 whitespace-pre-wrap">
        <span>
          <span style={{ color: PROMPT_COLOR }}>{PROMPT}$ </span>
          {exportLabel.toLowerCase()}?
        </span>
        <span aria-hidden="true">[</span>
        <Link
          ref={yRef}
          href={href}
          aria-label={exportLabel}
          className="inline-flex min-h-6 min-w-6 items-center justify-center rounded font-bold underline underline-offset-2 hover:bg-nominal/15 focus:outline-none focus-visible:bg-nominal/20"
          style={{ color: CYAN }}
        >
          y
        </Link>
        <span aria-hidden="true">/</span>
        <button
          type="button"
          onClick={() => setAnswered('n')}
          aria-label="Decline export"
          className="inline-flex min-h-6 min-w-6 items-center justify-center rounded font-bold underline underline-offset-2 hover:bg-nominal/15 focus:outline-none focus-visible:bg-nominal/20"
          style={{ color: CYAN }}
        >
          n
        </button>
        <span aria-hidden="true">]</span>
        {answered === null && (
          <span
            aria-hidden="true"
            className="inline-block h-[1.05em] w-[0.55ch] translate-y-[0.18em] motion-safe:[animation:cursor-blink_1.05s_step-end_infinite]"
            style={{ background: CYAN }}
          />
        )}
      </div>
      {answered === 'n' && <div style={{ color: CYAN }}>&gt; ok</div>}
    </aside>
  );
}
