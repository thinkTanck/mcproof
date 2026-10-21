import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  DETECTOR_HANDLE,
  LEGEND_ROLE_ORDER,
  OPERATOR_HANDLE,
  ROLES,
  SENTINEL_GLOSSARY_HREF,
  SENTINEL_HOST,
  SENTINEL_KEY_ROW,
  agentHandle,
  type RoleId,
} from '@/lib/replay/roles';
import { ReplayKey, transcriptKeyEntries } from './ReplayKey';

/**
 * THE LEGEND OF A REPLAY (Batch G, 2026-10-13): one strip directly ABOVE the
 * terminal it explains.
 *
 *  - WHO IS WHO: each prompt the replay draws, the role behind it and one
 *    sentence, from the roles lookup (`src/lib/replay/roles.ts`).
 *  - THE COLOUR KEY: `ReplayKey`, the same component batch D added under the
 *    step detail, MOVED here. One key, and still what the transcript's list
 *    points at with `aria-describedby`.
 *
 * AT EVERY WIDTH it is a native `<details>` named "Key", CLOSED when the page
 * opens (owner ruling, 2026-10-14), so Play stays above the fold at 1280 by 720,
 * and on a phone the terminal and Play stay where they were (the terminal gives up
 * the height of the closed summary: see `--scroll-cap-less` on it). Closed, the
 * colour key is still in the document, so the transcript's description still
 * resolves.
 *
 * The server cannot see the width, so `Replay` sends both and CSS shows the one
 * that fits; once the browser has answered, only that one is kept. The id the
 * transcript points at is on exactly one of them at any time (`withId`).
 *
 * STATIC TEXT, not a live region. The colour key holds no control. The one
 * link in the legend is the first "@sentinel" on the page, which goes to the
 * glossary entry that says what Sentinel is.
 *
 * NO TOOL OR SERVER HANDLE IS DRAWN IN A REPLAY TODAY (a tool call is printed
 * as the agent's own command), so the fourth entry has no handle to show. Its
 * chip says "tool or server" in words, and not in the prompt colour.
 */

function handleFor(role: RoleId, model: string): string | null {
  switch (role) {
    case 'operator':
      return OPERATOR_HANDLE;
    case 'agent':
      return agentHandle(model);
    case 'detector':
      return DETECTOR_HANDLE;
    case 'tool':
      return null;
  }
}

/** A handle, boxed: the chip each entry opens with. It may wrap; a long client name does. */
const CHIP =
  'instrument justify-self-start rounded border border-line px-1.5 py-0.5 [overflow-wrap:anywhere]';
/** One row of the Key: a subgrid of its two columns. */
const ROW = 'col-span-2 grid min-w-0 grid-cols-subgrid items-baseline';
/** What stands where a handle would, for the role that has none on screen. */
export const TOOL_TERM = 'served tool';

/**
 * EVERY "@sentinel" IN THE KEY LOOKS THE SAME (SENTINEL + KEY, B): one dotted
 * underline, whether it is the link to the glossary (the first handle) or
 * plain text (the other handle, the Sentinel row's chip).
 */
const SENTINEL_MARK = 'underline decoration-dotted underline-offset-4';

/** A handle as the legend prints it. The first "@sentinel" is the glossary link. */
function LegendHandle({ handle, linked }: { handle: string; linked: boolean }) {
  const at = `@${SENTINEL_HOST}`;
  if (!handle.endsWith(at)) return <>{handle}</>;
  return (
    <>
      {handle.slice(0, -at.length)}
      {linked ? (
        <Link
          href={SENTINEL_GLOSSARY_HREF}
          data-sentinel-mark=""
          // A link inside a label: its line is kept and a hit area of
          // `--target-min` is laid over it (`target-area`, globals.css).
          className={cn('target-area whitespace-nowrap', SENTINEL_MARK)}
        >
          {at}
        </Link>
      ) : (
        <span data-sentinel-mark="" className={cn('whitespace-nowrap', SENTINEL_MARK)}>
          {at}
        </span>
      )}
    </>
  );
}

function LegendBody({ model, keyId }: { model: string; keyId?: string }) {
  // The first role whose handle is at sentinel carries the glossary link.
  const firstAtSentinel = LEGEND_ROLE_ORDER.find((id) =>
    handleFor(id, model)?.endsWith(`@${SENTINEL_HOST}`),
  );
  return (
    <div className="flex flex-col gap-(--instrument-stack)">
      {/* ONE TWO-COLUMN GRID (owner ruling KEY POLISH, 2026-10-20): the chip
          column is as wide as the widest chip (up to 45%, past which a chip
          wraps inside itself), and every name and definition starts on one
          left edge and wraps under itself, never under the chip. Each row is a
          subgrid of it, so a row stays one box. The same at every width. */}
      <dl
        data-whos-who=""
        className="grid grid-cols-[fit-content(45%)_minmax(0,1fr)] gap-x-4 gap-y-(--instrument-stack-rows)"
      >
        {LEGEND_ROLE_ORDER.map((id) => {
          const role = ROLES[id];
          const handle = handleFor(id, model);
          const linked = id === firstAtSentinel;
          return (
            <div key={id} data-role={id} className={ROW}>
              {handle !== null ? (
                <dt
                  data-legend-handle={handle}
                  className={CHIP}
                  style={{ color: 'var(--terminal-prompt)' }}
                >
                  <LegendHandle handle={handle} linked={linked} />
                </dt>
              ) : (
                // Not a prompt on screen, so not in the prompt colour: the
                // rule's own words, for the handle no replay draws yet.
                <dt className={CHIP}>{TOOL_TERM}</dt>
              )}
              <dd className="reading measure min-w-0">
                <span className="font-semibold text-ink-hi">{role.name}.</span> {role.definition}
              </dd>
            </div>
          );
        })}
        {/* Sentinel itself, last: where every test runs, and a link to what
            it is. Its chip is not a prompt anyone types under, so it is not
            in the prompt colour. */}
        <div data-role="sentinel" className={ROW}>
          <dt className={CHIP}>
            <span data-sentinel-mark="" className={cn('whitespace-nowrap', SENTINEL_MARK)}>
              {SENTINEL_KEY_ROW.chip}
            </span>
          </dt>
          <dd className="reading measure min-w-0">
            <span className="font-semibold text-ink-hi">{SENTINEL_KEY_ROW.name}.</span>{' '}
            {SENTINEL_KEY_ROW.definition}{' '}
            <Link
              href={SENTINEL_GLOSSARY_HREF}
              className="target-area whitespace-nowrap text-nominal underline underline-offset-4"
            >
              {SENTINEL_KEY_ROW.link}
            </Link>
          </dd>
        </div>
      </dl>
      <ReplayKey id={keyId} entries={transcriptKeyEntries()} label="Colors" />
    </div>
  );
}

export function ReplayLegend({
  model,
  placement,
  keyId,
  className,
}: {
  /** The run's model label: the agent's handle is this, at sentinel. */
  model: string;
  /** Which copy this is. Both are a "Key" disclosure, closed by default. */
  placement: 'wide' | 'phone';
  /** The id the transcript points at. Handed to exactly one legend at a time. */
  keyId?: string;
  className?: string;
}) {
  return (
    <details data-replay-legend={placement} className={cn('group min-w-0', className)}>
      <summary className="micro-label one-line target-min inline-flex cursor-pointer list-none items-center gap-2 text-ink [&::-webkit-details-marker]:hidden">
        {/* The state, drawn: the chevron points right when closed and down
              when open. It turns at once, with no transition. */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          aria-hidden="true"
          focusable="false"
          className="shrink-0 group-open:rotate-90"
        >
          <path
            d="M4 2l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Key
      </summary>
      {/* Not drawn at all while closed (display: none, beyond what the browser
            does for a closed disclosure), so nothing in it is measured as if it
            were on screen. It stays in the document, so the id still resolves. */}
      {/* OPEN, ITS OWN PANEL (owner ruling KEY POLISH, 2026-10-20): the panel
            surface and line tokens, no new colour, and room under it before
            the terminal. */}
      <div
        data-key-panel=""
        className="mb-2 mt-1 rounded-lg border border-line bg-panel px-4 py-3 [details:not([open])>&]:hidden"
      >
        <LegendBody model={model} keyId={keyId} />
      </div>
    </details>
  );
}
