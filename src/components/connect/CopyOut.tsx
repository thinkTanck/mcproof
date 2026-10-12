'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A value the user has to move OUT of this screen and into their agent: the run
 * endpoint, the run token, the task goal.
 *
 * Two type roles, picked per value and not by taste. An endpoint or a token is
 * TELEMETRY — a machine string, so it wears the INSTRUMENT role (mono readout).
 * The task goal is a SENTENCE A HUMAN READS before pasting it, so it wears the
 * READING role. Prose never renders at instrument size on this screen, which is
 * a blocking rule rather than a preference.
 *
 * ── SECRETS ──
 *
 * `secret` masks the value on screen while still copying the real one. The mask
 * is a CONSTANT, not derived from the value, so it cannot leak the length. This
 * is not encryption and does not pretend to be: the point is that a screen-shared
 * or shoulder-surfed Connect page does not spill a live credential, while the one
 * legitimate use (paste it into your agent) still works in a single click.
 *
 * There is deliberately no `<input>` here. A form control is what a password
 * manager or an autofill store latches onto, and the run token must not be
 * persisted by anything, the browser included.
 *
 * ── `display`: A COMMAND THAT CARRIES A SECRET ──
 *
 * A ready-to-run client command has to contain the real run token or it does not
 * work, and it must not put that token on screen or the whole `secret` treatment
 * above is undone by the block underneath it. So `display` splits the two: it is
 * what gets RENDERED, while `value` is what gets COPIED.
 *
 * The caller builds the two strings SEPARATELY (see `ClientSetup`), rather than
 * rendering the real command through a find-and-replace. A replace that misses,
 * or a token that happens to contain a regex-special character, would print the
 * credential; a string built from a mask has never held it.
 *
 * ── WHEN COPYING FAILS ──
 *
 * The clipboard can refuse: no async clipboard on a plain-http address, an
 * in-app browser, a denied write. The fallback sentence then names the one
 * control that gets the reader to the real value, and never one the box lacks:
 *
 *   - a box already in full view: select it by hand, there is nothing to reveal;
 *   - a `secret` box: press its own REVEAL;
 *   - a box with a `display` mask: a SHOW button (`reveal` names what it shows,
 *     e.g. SHOW CONFIG) appears ONLY now, and pressing it draws `value` in the
 *     same box beside "This contains your run token. Don't share it."
 *
 * That last case is the one deliberate exception to `display` keeping the real
 * value out of the DOM, and it needs BOTH a failed copy and the reader's own
 * press. Pressing it again, a later successful copy, or a new `value` (a new
 * run) masks it again; a tab switch unmounts the box, which does the same.
 * Nothing about the value or the failure is logged.
 *
 * ── `tone="code"` ──
 *
 * A command is code: mono, never wrapped (a broken line is a broken command),
 * and scrolled INSIDE its own box so the page body never scrolls sideways. A box
 * that scrolls has to be reachable from the keyboard (WCAG 2.1.1), so it carries
 * `tabIndex` and a name of its own.
 *
 * On a phone held upright the box is also at most 45% of the screen tall
 * (`scroll-cap`, globals.css). The
 * longest config is about 41% of the smallest phone today, so this changes
 * nothing yet; it is the ceiling that keeps a longer one from filling the
 * screen with a box that takes the swipe. Past it the box scrolls inside
 * itself, and at either end the scroll chains to the page (no
 * `overscroll-behavior` is set).
 */
export function CopyOut({
  label,
  file,
  value,
  name,
  secret = false,
  tone = 'readout',
  display,
  reveal,
}: {
  /** INSTRUMENT label above the value. */
  label: string;
  /**
   * A file name or path the label ends with, shown EXACTLY as given. The label
   * is a micro-label and that role is uppercase, which is wrong for a file name:
   * names are case-sensitive on Linux and macOS, so `run-mcp.json` drawn as
   * `RUN-MCP.JSON` names a file the next command cannot find. It is passed
   * apart from `label` so the casing rule cannot reach it.
   */
  file?: string;
  value: string;
  /** What this value is, in words, for the control names: e.g. "run token". */
  name: string;
  secret?: boolean;
  /** `readout` = mono telemetry. `prose` = a sentence a human reads. `code` = a command. */
  tone?: 'readout' | 'prose' | 'code';
  /** Rendered instead of `value`, when the two must differ. `value` still copies. */
  display?: string;
  /**
   * What the SHOW button offered after a failed copy names, in capitals: CONFIG,
   * COMMAND, VALUE. Only meaningful with `display`. See WHEN COPYING FAILS.
   */
  reveal?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  // The failure-only exception: the real `value` drawn in place of `display`.
  const [shown, setShown] = useState(false);
  // A new value (a new run) starts masked, with no failure on record.
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setShown(false);
    setCopyFailed(false);
    setRevealed(false);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setCopyFailed(false);
      setShown(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Nothing is echoed and nothing reaches a log. The sentence below names
      // the control that puts the real value on screen to select by hand.
      setCopied(false);
      setCopyFailed(true);
    }
  };

  const hidden = secret && !revealed;
  const masked = display !== undefined;
  const showLabel = reveal ?? 'VALUE';

  return (
    <div className="rounded-lg border border-line bg-panel/60 px-4 py-3.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {/* A path has nowhere to break, so with the text enlarged it is
            allowed to break anywhere rather than run past the box (WCAG 1.4.4). */}
        <span className="micro-label min-w-0 [overflow-wrap:anywhere]">
          {label}
          {file !== undefined && (
            <>
              {' '}
              <span
                data-testid="copy-out-file"
                className="normal-case tracking-normal text-readout"
              >
                {file}
              </span>
            </>
          )}
        </span>
        <div className="flex items-center gap-2">
          {copied && (
            <span className="instrument text-nominal" role="status">
              COPIED
            </span>
          )}
          {secret && (
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              aria-pressed={revealed}
              aria-label={`${revealed ? 'Hide' : 'Reveal'} ${name}`}
              className="min-h-11 rounded-md border border-line px-3.5 py-2 font-mono text-[13px] tracking-[0.06em] text-ink-muted transition-colors hover:border-line-em hover:text-ink"
            >
              {revealed ? 'HIDE' : 'REVEAL'}
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            aria-label={`Copy ${name}`}
            className="min-h-11 rounded-md border border-line-em px-3.5 py-2 font-mono text-[13px] tracking-[0.06em] text-nominal transition-colors hover:bg-nominal/10"
          >
            COPY
          </button>
        </div>
      </div>
      {tone === 'code' ? (
        <pre
          role="group"
          aria-label={name}
          tabIndex={0}
          className="readout overflow-x-auto whitespace-pre pb-1 phone-tall:scroll-cap"
        >
          {shown ? value : (display ?? value)}
        </pre>
      ) : hidden ? (
        // `line-break: anywhere` is for WebKit. A row of bullets is punctuation,
        // and Safari will not break inside a run of punctuation for `break-all`
        // alone, so on an iPhone the mask ran off the edge of the page and was
        // cut there. Chromium already wrapped it.
        <p className="readout break-all text-ink-faint [line-break:anywhere]" aria-hidden="true">
          {MASK}
        </p>
      ) : (
        <p className={cn('break-words', tone === 'prose' ? 'reading' : 'readout break-all')}>
          {display ?? value}
        </p>
      )}
      {copyFailed && (
        <p className="reading measure mt-2 text-ink-muted">
          Copying did not work in this browser.{' '}
          {masked
            ? `Press SHOW ${showLabel} to see it in full, then select it by hand.`
            : secret
              ? `Press REVEAL, then select the ${name} by hand.`
              : 'Select it and copy it by hand.'}
        </p>
      )}
      {copyFailed && masked && (
        <div className="mt-3 flex flex-col items-start gap-2.5">
          {shown && (
            // CAUTION: an icon beside the words, never colour alone and never
            // red. A credential on screen is a risk to manage, not a breach.
            <p className="reading measure flex items-start gap-2">
              <span className="mt-[0.3em] text-caution">
                <CautionIcon />
              </span>
              This contains your run token. Don&apos;t share it.
            </p>
          )}
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            className="min-h-11 rounded-md border border-line px-3.5 py-2 font-mono text-[13px] tracking-[0.06em] text-ink-muted transition-colors hover:border-line-em hover:text-ink"
          >
            {shown ? `HIDE ${showLabel}` : `SHOW ${showLabel}`}
          </button>
        </div>
      )}
    </div>
  );
}

const CautionIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
    <path
      d="M7 1.5 13 12.5H1L7 1.5Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
    <path d="M7 5.6v3.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="7" cy="10.6" r="0.75" fill="currentColor" />
  </svg>
);

/** A constant mask. Derived from nothing, so it reveals nothing, not even length. */
const MASK = '•'.repeat(44);
