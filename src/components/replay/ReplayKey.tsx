import type { ReactNode } from 'react';
import { BandShape } from '@/components/leaderboard/BandShape';
import { stepColorToken } from '@/lib/hud/trace-view';
import { cn } from '@/lib/utils';
import type { StepType } from '@/contract';

/**
 * THE COLOUR KEY OF A REPLAY (UI audit 2026-10-12, batch D; WCAG 1.4.1, 1.3.1).
 *
 * A replay draws meaning in colour: the transcript's prompts, its step text and
 * its compromise step; the hero replay's dots, one colour per kind of step.
 * This is the list that says what each colour or mark means, in words, beside
 * a sample of it.
 *
 * The thing it explains points at it with `aria-describedby`, once, from the
 * element that holds the coloured rows (the transcript's list, the hero's
 * picture), so a screen reader hears the key as that element's description.
 *
 * STATIC TEXT. It is not a live region and holds nothing to focus. A replay
 * has one live region already (the step detail), and a key that announced
 * itself would talk over it.
 */

/** The id the replay transcript's list points at. One replay is on a page. */
export const REPLAY_KEY_ID = 'replay-key';
/** The id the hero replay on Home points at. */
export const HERO_KEY_ID = 'hero-replay-key';

export interface ReplayKeyEntry {
  /** A stable name for the entry. */
  id: string;
  /** A sample of the colour or the mark. Decoration: the label says it. */
  mark: ReactNode;
  /** What it means, in words. */
  label: string;
}

/** A square of one colour, for a colour that is drawn as text. */
function Swatch({ color }: { color: string }) {
  return (
    <span
      data-key-mark="swatch"
      className="inline-block h-2.5 w-2.5 rounded-sm"
      style={{ background: color }}
    />
  );
}

/** A round dot of one colour, as the hero replay draws a step. */
function Dot({ color }: { color: string }) {
  return (
    <span
      data-key-mark="dot"
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ background: color }}
    />
  );
}

/**
 * The transcript's key: the prompt colour, the step text colour, and the
 * compromise step, which is red AND carries a diamond. The key shows that
 * same diamond, so the mark is explained and not only the colour.
 */
export function transcriptKeyEntries(): ReplayKeyEntry[] {
  return [
    {
      id: 'prompt',
      mark: <Swatch color="var(--terminal-prompt)" />,
      label: 'Who is speaking',
    },
    {
      id: 'step',
      mark: <Swatch color="var(--text-readout)" />,
      label: 'What they said or did',
    },
    {
      id: 'breach',
      mark: (
        <span
          data-key-mark="breach"
          className="inline-flex"
          style={{ color: 'var(--text-breach)' }}
        >
          <BandShape band="breach" />
        </span>
      ),
      label: 'Where the agent was compromised',
    },
  ];
}

/** The hero replay's dot colours, in the order a run meets them. */
const HERO_KINDS: { id: string; types: StepType[]; label: string }[] = [
  { id: 'principal', types: ['principal_instruction'], label: "Operator's task" },
  { id: 'reasoning', types: ['agent_reasoning'], label: 'Agent reasoning' },
  { id: 'tool', types: ['tool_call', 'tool_result'], label: 'Tool call or result' },
  { id: 'memory', types: ['memory_read', 'memory_write'], label: 'Memory read or write' },
  { id: 'complete', types: ['task_complete'], label: 'Task complete' },
];

/**
 * The hero replay's key: one entry for each dot colour THIS trace draws (a
 * trace with no memory step gets no memory entry), then the breach reticle.
 * The colours come from `stepColorToken`, the same lookup the rail uses, so
 * the key cannot drift from the dots.
 */
export function heroKeyEntries(steps: readonly { type: StepType }[]): ReplayKeyEntry[] {
  const drawn = new Set(steps.map((step) => step.type));
  const kinds = HERO_KINDS.filter((kind) => kind.types.some((type) => drawn.has(type)));
  return [
    ...kinds.map((kind) => ({
      id: kind.id,
      mark: <Dot color={stepColorToken(kind.types[0]!)} />,
      label: kind.label,
    })),
    {
      id: 'breach',
      mark: (
        <svg data-key-mark="breach" width="12" height="12" viewBox="0 0 18 18">
          <circle cx="9" cy="9" r="7" fill="none" stroke="var(--status-breach)" strokeWidth="1.8" />
          <circle cx="9" cy="9" r="2.6" fill="var(--status-breach)" />
        </svg>
      ),
      label: 'Breach: the step where the agent was compromised',
    },
  ];
}

export function ReplayKey({
  id,
  entries,
  label = 'Key',
  className,
}: {
  /**
   * The word before the entries. "Key" where this is the whole key (the Home
   * hero); "Colors" inside the replay's legend, which is itself the Key, so
   * the word is said once (SENTINEL + KEY, B).
   */
  label?: string;
  /**
   * The id the explained element names in `aria-describedby`. Left out for a
   * copy that is not the one pointed at: the replay sends its legend twice
   * until the browser says which fits, and an id is on one element only.
   */
  id?: string;
  entries: ReplayKeyEntry[];
  className?: string;
}) {
  return (
    <div
      id={id}
      data-replay-key=""
      className={cn(
        'flex flex-wrap items-baseline gap-x-4 gap-y-(--instrument-stack-rows)',
        className,
      )}
    >
      <span data-replay-key-label="" className="micro-label">
        {label}
      </span>
      <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-(--instrument-stack-rows)">
        {entries.map((entry) => (
          <li
            key={entry.id}
            data-replay-key-entry={entry.id}
            className="instrument inline-flex items-center gap-2"
          >
            <span aria-hidden="true" className="inline-flex shrink-0 items-center">
              {entry.mark}
            </span>
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
