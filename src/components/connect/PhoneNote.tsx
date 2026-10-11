import Link from 'next/link';
import { PHONE_NOTE_LINKS, PHONE_NOTE_TEXT } from './phone-note-copy';

/**
 * THE PHONE NOTE: what a visitor on a phone can do from Connect.
 *
 * Running a test means registering an MCP endpoint with an agent, which needs a
 * terminal or a code editor. A phone has neither, and the screen used to leave
 * the visitor to find that out at the last step. So below 768px it says so
 * first, and points at the three things that do work from a phone.
 *
 * ── HIDDEN BY CSS, NEVER BY SCRIPT ──
 *
 * `md:hidden` is `display: none` from 768px up, so on a desk the note is out of
 * layout and out of the accessibility tree. There is no width read in script:
 * no window listener, nothing to hydrate, and so no flash of the note on a wide
 * screen before a script takes it away again.
 *
 * ── INFORMATION, SO INERT ──
 *
 * Nothing has gone wrong and nothing is at risk, so this is neither the breach
 * red nor the caution amber. It wears the neutral fourth state
 * (`--status-inert`, ADR-0003) as a mark beside the sentence, never colour
 * alone. There is no label above the sentence: the note opens on its own words.
 * It is a `note`, not an alert and not a live region: it is there on arrival
 * and announces nothing by itself.
 *
 * It cannot be dismissed, because the fact does not stop being true, and it
 * hides, disables and moves nothing else on the screen. The sentence is READING
 * prose on the measure.
 */

const InfoMark = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    aria-hidden="true"
    focusable="false"
    data-testid="phone-note-mark"
    className="mt-[0.4em] shrink-0"
  >
    <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M6 5.4v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="6" cy="3.6" r="0.7" fill="currentColor" />
  </svg>
);

const Chevron = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    aria-hidden="true"
    focusable="false"
    className="shrink-0 text-ink-faint"
  >
    <path
      d="M4.5 2.5 8 6l-3.5 3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function PhoneNote() {
  return (
    <div
      role="note"
      className="mb-7 rounded-lg border border-line bg-panel/60 px-4 py-3.5 md:hidden"
    >
      <div className="flex items-start gap-2.5">
        <span className="flex shrink-0" style={{ color: 'var(--status-inert)' }}>
          <InfoMark />
        </span>
        <p className="reading measure">{PHONE_NOTE_TEXT}</p>
      </div>
      {/* One link to a row, so no two targets sit side by side on a 320px screen. */}
      <ul className="mt-3 flex flex-col gap-2">
        {PHONE_NOTE_LINKS.map(({ label, href }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5 font-sans text-[15px] text-ink-hi transition-colors hover:border-line-em"
            >
              {label}
              <Chevron />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
