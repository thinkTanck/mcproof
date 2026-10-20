'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { followStepInside, scrollingBox } from './follow-step';
import {
  SENTINEL_GLOSSARY_HREF,
  handleName,
  isSentinelHandle,
  roleForHandle,
} from '@/lib/replay/roles';

/**
 * A SPEAKER HANDLE THAT OPENS ITS DEFINITION (Batch G, 2026-10-13).
 *
 * `user@console`, `target-agent@sentinel` and `detector@sentinel` are prompts
 * in a replay. Each is a control now: press it and one sentence says who that
 * is, from the roles lookup (`src/lib/replay/roles.ts`).
 *
 * A NATIVE DISCLOSURE, AND WHY IT IS NOT A `<button>`. A step's row in the
 * transcript is already a button, and a button inside a button is not valid.
 * So the handle is a SIBLING of the row's button, laid over the prompt at the
 * start of the row. It is a `<details>` with a `<summary>`, the same thing the
 * OWASP explainer on Home is: it opens with a press, a tap, Enter and Space,
 * and the browser itself reports whether it is open. It is not a `<button>`
 * because the steps are the list's buttons, all of them and nothing else, and
 * the keyboard and screen-reader guards count them
 * (tests/e2e/replay-keyboard.spec.ts). The definition is only in the document
 * while it is open: a transcript can have dozens of rows, and a closed one
 * should add no text and no link to any of them.
 *
 * WHERE THE DEFINITION IS DRAWN: in the flow, directly under the line it
 * belongs to. Not a floating layer. The transcript scrolls inside itself and
 * is capped on a phone, and a layer would be cut off by that box; a block in
 * the flow cannot be. Opening one makes its row taller and the box scrolls it
 * into view.
 *
 * ONE AT A TIME, across the transcript and the verdict rail, held by
 * `SpeakerDefinitions`. Escape closes the open one and gives focus back to its
 * handle; a press anywhere outside it closes it.
 *
 * NOT A LIVE REGION. It is opened by the reader, so the reader is already
 * there; announcing it as well would talk over the step detail, which is the
 * one live region a replay has.
 */

interface SpeakerState {
  openId: string | null;
  setOpenId: (id: string | null) => void;
}

const SpeakerContext = createContext<SpeakerState | null>(null);

/** Holds which definition is open, so that only one is. Wraps a whole replay. */
export function SpeakerDefinitions({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (openId === null) return;
    const openOne = () =>
      [...document.querySelectorAll<HTMLElement>('[data-speaker-id]')].find(
        (el) => el.getAttribute('data-speaker-id') === openId,
      ) ?? null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const handle = openOne();
      setOpenId(null);
      handle?.querySelector<HTMLElement>(':scope > summary')?.focus({ preventScroll: true });
    };
    // A press outside closes it. On `click`, not on pointer down: closing takes
    // the definition out of the flow, the rows under it move up, and a press
    // that began on one control would end on another. A press on any handle
    // is that handle's own business (it opens, or closes, itself).
    const onPress = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-speaker-id]')) return;
      setOpenId(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onPress);
    };
  }, [openId]);

  const value = useMemo(() => ({ openId, setOpenId }), [openId]);
  return <SpeakerContext.Provider value={value}>{children}</SpeakerContext.Provider>;
}

/** Open or closed, shared when a replay holds the state and local when none does. */
function useOpen(id: string): [boolean, (open: boolean) => void] {
  const shared = useContext(SpeakerContext);
  const [local, setLocal] = useState(false);
  const open = shared ? shared.openId === id : local;
  const setOpen = useCallback(
    (next: boolean) => {
      if (shared) shared.setOpenId(next ? id : null);
      else setLocal(next);
    },
    [shared, id],
  );
  return [open, setOpen];
}

export function SpeakerHandle({
  handle,
  tabbable = false,
  place = 'row',
  className,
}: {
  /** The handle as it is printed: `target-agent@sentinel`. */
  handle: string;
  /**
   * Is it a Tab stop? Not inside the transcript: there a step is one stop, and
   * the arrow keys move between a step and its handle.
   */
  tabbable?: boolean;
  /**
   * `row`: at the start of a transcript row, which is at least a target tall,
   * so the control fills the row's first target of height.
   * `line`: at the start of one line of a terminal, so the control is centred
   * on that line and reaches a little above and below it.
   */
  place?: 'row' | 'line';
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useOpen(id);
  const role = roleForHandle(handle);
  const panelRef = useRef<HTMLDivElement>(null);

  // Bring the definition into view inside the box that scrolls. While the
  // replay plays, that box and nothing else: the page never moves under a
  // viewer watching it (owner ruling REPLAY SCROLL, 2026-10-20). Paused or at
  // rest, the page may also bring what the viewer just opened on screen.
  // Guarded because jsdom (unit tests) does not implement scrollIntoView.
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const box = scrollingBox(panel);
    if (box) followStepInside(box, panel, false);
    if (!panel.closest('[data-replay-playing]') && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ block: 'nearest' });
    }
  }, [open]);

  return (
    <details
      data-speaker-handle={handle}
      data-speaker-id={id}
      open={open}
      className={cn('min-w-0', className)}
    >
      <summary
        aria-label={handleName(handle)}
        tabIndex={tabbable ? undefined : -1}
        // The state is React's, so that one opening closes the others. The
        // browser's own toggle is stopped and the attribute follows the state.
        onClick={(event) => {
          event.preventDefault();
          setOpen(!open);
        }}
        // No text of its own: the handle is printed by the line it lies over,
        // exactly where it always was, and this is as wide as that handle (a
        // monospace font, so one `ch` a character) and one target tall. Never
        // wider than its line: with the text enlarged a handle wraps, and a
        // box as wide as the unwrapped handle would push the line sideways.
        style={{ width: `${handle.length}ch` }}
        className={cn(
          'absolute left-0 z-10 block h-(--target-min) max-w-full min-w-(--target-min) cursor-pointer list-none rounded-sm focus-inside [&::-webkit-details-marker]:hidden',
          place === 'row' ? 'top-0' : 'top-[calc((1lh_-_var(--target-min))/2)]',
        )}
      />
      {open && (
        <div
          ref={panelRef}
          data-speaker-panel=""
          className="my-1 rounded-md border border-line bg-solid px-3 py-2 whitespace-normal"
        >
          <p className="reading measure">
            <span className="font-semibold text-ink-hi">{role.name}.</span> {role.definition}
            {isSentinelHandle(handle) && (
              <>
                {' '}
                <Link
                  href={SENTINEL_GLOSSARY_HREF}
                  className="text-nominal underline underline-offset-4"
                >
                  What is Sentinel?
                </Link>
              </>
            )}
          </p>
        </div>
      )}
    </details>
  );
}

/**
 * The handle as it is printed in a prompt, marked as something to press: a
 * dotted underline, so it is not told from the rest of the prompt by colour
 * alone. Decoration for the eye; the control itself is `SpeakerHandle`.
 *
 * It is drawn ABOVE the control that lies over it (`z-20` over the control's
 * `z-10`) and lets every press through to it (`pointer-events-none`). The
 * text is then the top thing where it is drawn, so a contrast check reads it
 * against the terminal and does not report it as covered by something else.
 */
export function PrintedHandle({ handle }: { handle: string }) {
  return (
    <span
      data-printed-handle=""
      className="pointer-events-none relative z-20 underline decoration-dotted underline-offset-4"
    >
      {handle}
    </span>
  );
}
