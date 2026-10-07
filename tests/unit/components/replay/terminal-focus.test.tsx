import { useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReplayTerminal } from '@/components/replay/ReplayTerminal';
import { sampleRun } from '@/data/source';

/**
 * NO TAB STOP ON A STEP NOBODY CAN SEE (sweep 2026-10-07, R1; WCAG 2.4.7).
 *
 * The terminal draws a step only once the playhead has reached it. Steps still
 * ahead are kept in the accessibility tree, visually hidden, so a screen reader
 * can read the whole list and jump to any step. But they were also left in the
 * TAB ORDER: at the start of the sample run a sighted keyboard user pressed Tab
 * seven times with focus on a one-pixel element and nothing on screen to show
 * for it, before reaching the transport.
 *
 * The rule held here: a step that is not drawn is not a tab stop. It stays a
 * labelled button in the list, so assistive technology reads it and can activate
 * it exactly as before.
 */

const RUN = sampleRun('ASI02');
const STEPS = RUN.trace.steps;
const TOTAL = STEPS.length;
const COMPROMISE = STEPS.findIndex((step) => step.id === RUN.verdict.stepId);

function terminal(current: number, onSelect: (index: number) => void = () => {}) {
  return render(
    <ReplayTerminal
      steps={STEPS}
      current={current}
      compromiseIndex={COMPROMISE}
      model={RUN.model}
      onSelect={onSelect}
    />,
  );
}

const list = () => screen.getByRole('list', { name: 'Attack replay step timeline' });
const stepButtons = () => within(list()).getAllByRole('button');
/** Drawn on screen: not inside the visually hidden wrapper. */
const drawn = (button: HTMLElement) => button.closest('.sr-only') === null;
/** In the tab order. */
const tabbable = (button: HTMLElement) => button.tabIndex >= 0;

describe('ReplayTerminal · the fixture this file reasons about', () => {
  it('is the eight-step sample whose compromise is step 6', () => {
    expect(TOTAL).toBe(8);
    expect(COMPROMISE).toBe(5);
  });
});

describe('ReplayTerminal · a step that is not drawn is not a tab stop', () => {
  it.each(Array.from({ length: TOTAL }, (_, current) => current))(
    'playhead on step %i: every tabbable step is drawn, and every drawn step is tabbable',
    (current) => {
      terminal(current);

      for (const [i, button] of stepButtons().entries()) {
        expect(drawn(button), `step ${i + 1} drawn`).toBe(i <= current);
        expect(tabbable(button), `step ${i + 1} tabbable`).toBe(i <= current);
      }
    },
  );

  it('at the start: one tab stop in the list, and the next Tab leaves it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ReplayTerminal
          steps={STEPS}
          current={0}
          compromiseIndex={COMPROMISE}
          model={RUN.model}
          onSelect={() => {}}
        />
        <button type="button">Restart</button>
      </>,
    );

    await user.tab();
    expect(screen.getByRole('button', { name: /^Step 1:/ })).toHaveFocus();
    // It used to take seven more presses, each on an invisible step, to get here.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Restart' })).toHaveFocus();
  });

  it('mid-playback (step 4): four tab stops, then out of the list', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ReplayTerminal
          steps={STEPS}
          current={3}
          compromiseIndex={COMPROMISE}
          model={RUN.model}
          onSelect={() => {}}
        />
        <button type="button">Restart</button>
      </>,
    );

    const visited: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      visited.push(
        document.activeElement?.getAttribute('aria-label') ??
          document.activeElement?.textContent ??
          '',
      );
    }

    expect(visited.slice(0, 4).map((name) => name.slice(0, 7))).toEqual([
      'Step 1:',
      'Step 2:',
      'Step 3:',
      'Step 4:',
    ]);
    expect(visited[4]).toBe('Restart');
  });

  it('at the end: every step is drawn and every step is a tab stop', () => {
    terminal(TOTAL - 1);

    expect(stepButtons()).toHaveLength(TOTAL);
    expect(stepButtons().every(drawn)).toBe(true);
    expect(stepButtons().every(tabbable)).toBe(true);
  });
});

describe('ReplayTerminal · a screen reader still gets every step', () => {
  it('keeps all the steps in the list, labelled, whatever the playhead', () => {
    terminal(0);

    expect(stepButtons()).toHaveLength(TOTAL);
    for (const [i, button] of stepButtons().entries()) {
      expect(button).toHaveAccessibleName(new RegExp(`^Step ${i + 1}: `));
      // Still exposed: hidden from sight only, never from assistive technology.
      expect(button.closest('[aria-hidden="true"], [inert], [hidden]')).toBeNull();
    }
    expect(stepButtons()[COMPROMISE]).toHaveAccessibleName(/, compromise step$/);
  });

  it('activating a step that is not drawn yet still jumps to it', async () => {
    // What a screen reader's virtual cursor does: it activates the control
    // without it ever having been a tab stop.
    const user = userEvent.setup();
    const onSelect = vi.fn();
    terminal(0, onSelect);

    await user.click(stepButtons()[COMPROMISE]!);

    expect(onSelect).toHaveBeenCalledWith(COMPROMISE);
  });

  it('marks the playhead with aria-current, on a step that is a tab stop', () => {
    terminal(2);

    const current = stepButtons().filter((b) => b.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(/^Step 3: /);
    expect(tabbable(current[0]!)).toBe(true);
  });
});

describe('ReplayTerminal · guard: a reached step keeps its keyboard behaviour', () => {
  it('is focusable, scrubs when activated from the keyboard, and does not opt out of the focus ring', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    terminal(3, onSelect);
    const second = stepButtons()[1]!;

    second.focus();
    expect(second).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(1);

    // The ring itself is drawn by the site-wide :focus-visible rule and measured
    // in a browser (tests/e2e/replay-keyboard.spec.ts). Here: the button is a real
    // button and nothing on it removes itself from the tab order.
    expect(second.tagName).toBe('BUTTON');
    expect(second).not.toHaveAttribute('tabindex', '-1');
    expect(second).not.toBeDisabled();
  });
});

describe('ReplayTerminal · jumping to a step that was not drawn', () => {
  /** The terminal with a real playhead, as the replay screen holds it. */
  function Harness() {
    const [current, setCurrent] = useState(0);
    return (
      <>
        <ReplayTerminal
          steps={STEPS}
          current={current}
          compromiseIndex={COMPROMISE}
          model={RUN.model}
          onSelect={setCurrent}
        />
        <output data-testid="playhead">{current}</output>
      </>
    );
  }

  it('moves the playhead there, and the step it lands on is drawn, tabbable and visibly focused', () => {
    render(<Harness />);
    const target = stepButtons()[COMPROMISE]!;
    // Before: hidden from sight and out of the tab order, but still a button.
    expect(drawn(target)).toBe(false);
    expect(tabbable(target)).toBe(false);

    // What a screen reader does on activation: focus the control, then click it.
    // No Tab press is involved, so tabIndex -1 is no obstacle.
    act(() => {
      target.focus();
      target.click();
    });

    expect(screen.getByTestId('playhead')).toHaveTextContent(String(COMPROMISE));
    const landed = stepButtons()[COMPROMISE]!;
    expect(landed).toHaveAttribute('aria-current', 'step');
    expect(drawn(landed)).toBe(true);
    expect(tabbable(landed)).toBe(true);
    // Every step up to it is drawn and tabbable now; every step after is neither.
    for (const [i, button] of stepButtons().entries()) {
      expect(drawn(button), `step ${i + 1} drawn`).toBe(i <= COMPROMISE);
      expect(tabbable(button), `step ${i + 1} tabbable`).toBe(i <= COMPROMISE);
    }
    // Focus is never left on something hidden. If it stayed on the step, that
    // step is on screen; if it moved, it is not on a hidden step.
    const focused = document.activeElement as HTMLElement;
    if (stepButtons().includes(focused)) {
      expect(focused).toBe(landed);
      expect(focused.closest('.sr-only')).toBeNull();
    }
  });
});
