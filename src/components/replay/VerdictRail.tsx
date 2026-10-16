'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Verdict } from '@/contract';
import { AsiLabel, RUN_CATEGORY_NAME_ID } from '@/components/hud';
import { DETECTOR_HANDLE } from '@/lib/replay/roles';
import { PrintedHandle, SpeakerHandle } from './SpeakerHandle';

/**
 * The detector verdict, rendered as a second terminal (same rules as the
 * transcript: bare console, one colour, breach-red for the compromise facts). It
 * prints the verdict summary (outcome, category, severity, the step it was
 * compromised at), then an export question with two real buttons under it:
 * "Open fix report" opens the report for this run (/findings/[id]); "Not now"
 * closes the question, prints `ok` and opens nothing. There is no rationale
 * prose; the summary is the whole of it.
 *
 * WHAT THE PROMPT OFFERS DEPENDS ON WHAT WAS FOUND. A compromise opens a FIX
 * REPORT, because there is something to fix. A clean run opens a RUN RESULT:
 * the same route, the same record, but calling it a fix report would tell the
 * reader their clean run was a failed attempt at one. Both results are
 * first-class, and the noun has to say so.
 *
 * TWO REAL BUTTONS (owner ruling 2026-10-15 20:26). The answers used to be one
 * letter each, `[y / n]`. Now each is a labelled control at least
 * `--target-min` tall (`target-min`), in the tab order for everyone, touch and
 * desktop. While the question is open, pressing y or n ANYWHERE answers it
 * (like a real console prompt): `y` follows the link, `n` is "Not now". After
 * "Not now" focus moves to the prompt line (`tabIndex={-1}`, drawing its ring
 * inside itself), because the button it was on is gone and focus must not fall
 * back to the page body.
 *
 * THE FIRST PROMPT OPENS ITS DEFINITION (Batch G, 2026-10-13): who
 * `detector@sentinel` is, from the roles lookup, drawn under that line
 * (`SpeakerHandle`). It is a Tab stop here, the first thing in the rail. The
 * second prompt, on the export line, is printed and not a control.
 */
const CYAN = 'var(--text-readout)';
const BREACH = 'var(--text-breach)';
const PROMPT_COLOR = 'var(--terminal-prompt)';
const PROMPT = `${DETECTOR_HANDLE}:~`;
/**
 * The key column: 11 characters, as it has always been, so the short keys
 * still fit a 320px screen at doubled text. The one longer key ("compromised
 * at") runs past it by a few characters and keeps one space before its value.
 */
const KEY_WIDTH = 11;
const keyCell = (k: string) => (k.length >= KEY_WIDTH ? `${k} ` : k.padEnd(KEY_WIDTH, ' '));

/**
 * The two answers to the export question. Each is a real control with a box of
 * at least `--target-min` each way (`target-min`), drawn as the HUD's filled and
 * outlined buttons. Neither styles its own focus ring: the global
 * `:focus-visible` outline is the one ring.
 */
const OPEN_ANSWER =
  'target-min inline-flex items-center justify-center rounded-md border border-nominal bg-nominal/10 px-4 font-mono text-[14px] tracking-[0.06em] text-ink glow-accent transition-colors hover:bg-nominal/20';
const NOT_NOW_ANSWER =
  'target-min inline-flex items-center justify-center rounded-md border border-line-em bg-transparent px-4 font-mono text-[14px] tracking-[0.06em] text-ink glow-accent transition-colors hover:border-nominal hover:bg-nominal/10';

function Row({ k, v, breachValue }: { k: string; v: string; breachValue?: boolean }) {
  return (
    <div className="whitespace-pre-wrap" style={{ color: CYAN }}>
      <span style={{ opacity: 0.85 }}>{keyCell(k)}</span>
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
  const openLabel = compromised ? 'Open fix report' : 'Open run result';
  const [answered, setAnswered] = useState<null | 'n'>(null);
  const yRef = useRef<HTMLAnchorElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  // Focus follows "Not now" to the prompt line only when someone answered (a
  // press or a key), never on a first render or a RESET remount.
  const focusPrompt = useRef(false);

  const decline = () => {
    focusPrompt.current = true;
    setAnswered('n');
  };

  useEffect(() => {
    if (answered === 'n' && focusPrompt.current) {
      focusPrompt.current = false;
      promptRef.current?.focus({ preventScroll: true });
    }
  }, [answered]);

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
        focusPrompt.current = true;
        setAnswered('n');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answered]);

  return (
    <aside
      aria-label="Detector verdict"
      data-elev="2"
      className="overflow-y-auto rounded-lg px-4 py-3 font-mono text-[15px] leading-[1.6]"
      // `overflow-wrap: anywhere`: the prompt is one long word, and with the
      // text enlarged on a phone it ran past the rail and was cut (WCAG 1.4.4).
      // In the style, not the class list: tests/e2e/replay-wide-unchanged.spec.ts
      // holds this box to main's classes, and this changes nothing when it fits.
      style={{
        height: 'clamp(280px, 40vh, 460px)',
        background: 'var(--terminal-bg)',
        color: CYAN,
        overflowWrap: 'anywhere',
      }}
    >
      {/* The ROUTE id here too, for the same reason as the link. `verdict.runId`
          on a saved live run is the session's id: it is in no URL, it opens
          nothing, and beside a different id in the address bar it read as
          another run's verdict. */}
      <div className="relative">
        <span style={{ color: PROMPT_COLOR }}>
          <PrintedHandle handle={DETECTOR_HANDLE} />
          :~$
        </span>{' '}
        verdict --run {routeId}
        <SpeakerHandle handle={DETECTOR_HANDLE} place="line" tabbable />
      </div>
      <Row
        k="outcome"
        v={compromised ? 'COMPROMISED' : 'NOT COMPROMISED'}
        breachValue={compromised}
      />
      {/* The code the judge returned, with that code's name: the rail wraps,
          so there is room for both. It is the verdict's category, which for a
          recorded misfiling is not the class the run staged, and it is never
          relabelled: it only gets its name, like any other code. The status
          bar's chip points here for the name it has no room for. */}
      <div className="whitespace-pre-wrap" style={{ color: CYAN }}>
        <span style={{ opacity: 0.85 }}>{keyCell('category')}</span>
        <AsiLabel code={verdict.category} id={RUN_CATEGORY_NAME_ID} />
      </div>
      <Row k="severity" v={verdict.severity.toUpperCase()} breachValue={compromised} />
      {compromised && compromiseStepNumber !== null && (
        <Row
          k="compromised at"
          v={`#${compromiseStepNumber}${offendingLabel ? ` ${offendingLabel}` : ''}`}
          breachValue
        />
      )}

      {/* The export question, then its two answers as real buttons. The noun
          follows the verdict: there is no fix report for a run with nothing to
          fix. The `[y/n]` after the question is a printed hint for the keys:
          hidden from a screen reader, and on a touch screen, which has no keys
          to press. After "Not now" this line takes focus and prints `ok`. */}
      <div
        ref={promptRef}
        data-testid="export-prompt"
        tabIndex={-1}
        className="focus-inside mt-3 whitespace-pre-wrap"
      >
        <span style={{ color: PROMPT_COLOR }}>{PROMPT}$ </span>
        {exportLabel.toLowerCase()}?
        {answered === null && (
          <span aria-hidden="true" className="pointer-coarse:hidden">
            {' [y/n]'}
          </span>
        )}
        {answered === 'n' && <div style={{ color: CYAN }}>&gt; ok</div>}
      </div>
      {answered === null && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link ref={yRef} href={href} className={OPEN_ANSWER}>
            {openLabel}
          </Link>
          <button type="button" onClick={decline} className={NOT_NOW_ANSWER}>
            Not now
          </button>
        </div>
      )}
    </aside>
  );
}
