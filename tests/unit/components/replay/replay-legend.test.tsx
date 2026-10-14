import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Replay } from '@/components/replay';
import { REPLAY_KEY_ID } from '@/components/replay/ReplayKey';
import { CategorySchema, type RunResult } from '@/contract';
import { sampleRun } from '@/data/source';
import {
  ROLES,
  SENTINEL_GLOSSARY_HREF,
  handleName,
  roleForHandle,
  type RoleId,
} from '@/lib/replay/roles';

/**
 * THE LEGEND ABOVE THE TERMINAL, AND THE HANDLES THAT OPEN THEIR DEFINITION
 * (Batch G, 2026-10-13).
 *
 * The colour key sat under the step detail, a screen away from the transcript
 * it explains, and nothing said who `user@console` or `target-agent@sentinel`
 * is. One legend now sits directly above the terminal: who is who, then the
 * colour key (the same component, moved, still what the transcript's list
 * points at). Each handle in the transcript opens its own definition.
 *
 * jsdom has no layout and no media queries, so it draws the wide arrangement.
 * Where things sit on a screen, the phone disclosure and the real keyboard are
 * measured in a browser (tests/e2e/replay-legend-roles.spec.ts).
 */

const RUN = sampleRun('ASI02');
const TOTAL = RUN.trace.steps.length;

/** A finished live run looks like this to the replay: the client's own name. */
function liveRun(model: string, compromised: boolean): RunResult {
  const verdict: RunResult['verdict'] = compromised
    ? RUN.verdict
    : { ...RUN.verdict, compromised: false, severity: 'None' };
  // A clean verdict anchors no step.
  if (!compromised) delete verdict.stepId;
  return { ...RUN, model, trace: { ...RUN.trace, model }, verdict };
}

const legend = () => document.querySelector('[data-replay-legend]') as HTMLElement;
const timeline = () => screen.getByRole('list', { name: /step timeline/i });
const handles = () => [...document.querySelectorAll<HTMLElement>('[data-speaker-handle]')];
const summaryOf = (handle: HTMLElement) => handle.querySelector('summary') as HTMLElement;
const isOpen = (handle: HTMLElement) => (handle as HTMLDetailsElement).open;

function toEnd() {
  const scrub = screen.getAllByRole('slider', { name: 'Scrub to step' })[0]!;
  fireEvent.change(scrub, { target: { value: String(TOTAL - 1) } });
}

describe('the legend: one strip, directly above the terminal', () => {
  it('comes before the terminal in the document, and the old key under the step detail is gone', () => {
    render(<Replay run={RUN} routeId="sample" />);
    expect(document.querySelectorAll('[data-replay-legend]')).toHaveLength(1);
    const before = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(legend(), timeline())).toBe(true);

    const key = document.getElementById(REPLAY_KEY_ID)!;
    expect(legend().contains(key)).toBe(true);
    // One key in the whole replay, and nothing after the step detail.
    expect(document.querySelectorAll('[data-replay-key]')).toHaveLength(1);
    const detail = screen.getByRole('region', { name: 'Step detail' });
    expect(before(key, detail)).toBe(true);
    expect(detail.nextElementSibling).toBeNull();
  });

  it('the transcript still points at the one colour key', () => {
    render(<Replay run={RUN} routeId="sample" />);
    expect(timeline()).toHaveAttribute('aria-describedby', REPLAY_KEY_ID);
    const key = document.getElementById(REPLAY_KEY_ID)!;
    expect(key).toHaveAttribute('data-replay-key');
    expect(
      [...key.querySelectorAll('[data-replay-key-entry]')].map((e) =>
        e.getAttribute('data-replay-key-entry'),
      ),
    ).toEqual(['prompt', 'step', 'breach']);
    // The key itself is still not a control.
    expect(key.querySelector('a, button, summary, [tabindex]')).toBeNull();
  });

  it('says who is who, from the roles lookup, in the owner’s words', () => {
    render(<Replay run={RUN} routeId="sample" />);
    const who = legend().querySelector('[data-whos-who]') as HTMLElement;
    const entries = [...who.querySelectorAll<HTMLElement>('[data-role]')];
    expect(entries.map((e) => e.getAttribute('data-role'))).toEqual([
      'operator',
      'agent',
      'detector',
      'tool',
    ]);
    // The chip, a space, the sentence: read part by part, the way a browser
    // lays the two boxes out side by side.
    const text = (id: RoleId) =>
      [...who.querySelectorAll(`[data-role="${id}"] > *`)]
        .map((part) => (part.textContent ?? '').replace(/\s+/g, ' ').trim())
        .join(' ');
    expect(text('operator')).toBe(
      'user@console Operator. The person giving the agent a normal task.',
    );
    expect(text('agent')).toBe(
      'target-agent@sentinel Agent under test. The AI agent this run tests.',
    );
    expect(text('detector')).toBe(
      'detector@sentinel MCProof detector. Flags the step where the agent is compromised, if it is.',
    );
    // No tool or server handle is drawn anywhere in a replay, so this entry
    // has no handle of its own to show: its chip says which kind it is, in words.
    expect(text('tool')).toBe(
      'tool or server Served tool. An MCP tool we host for the run. In an attack run, one of them carries the attack.',
    );
    expect(who.querySelector('[data-role="tool"] [data-legend-handle]')).toBeNull();
    for (const entry of entries) {
      const role = ROLES[entry.getAttribute('data-role') as RoleId];
      expect(entry).toHaveTextContent(`${role.name}. ${role.definition}`);
    }
  });

  it('a definition is prose, so it wears the reading role and never an instrument one', () => {
    render(<Replay run={RUN} routeId="sample" />);
    for (const dd of legend().querySelectorAll('[data-whos-who] dd')) {
      const classes = dd.className.split(/\s+/);
      expect(classes).toContain('reading');
      expect(
        classes.some((c) => /^(instrument|instrument-faint|micro-label|readout)$/.test(c)),
      ).toBe(false);
    }
  });

  it('names the agent by the run’s own model, so a live run shows its client', () => {
    render(<Replay run={liveRun('claude-code', true)} routeId="some-row-id" />);
    const agent = legend().querySelector('[data-role="agent"]')!;
    expect(agent).toHaveTextContent('claude-code@sentinel');
  });

  it('is static text: not a live region', () => {
    render(<Replay run={RUN} routeId="sample" />);
    const LIVE =
      '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"], output';
    expect(legend().matches(LIVE)).toBe(false);
    expect(legend().querySelector(LIVE)).toBeNull();
    expect(legend().closest(LIVE)).toBeNull();
    expect(document.querySelectorAll(LIVE)).toHaveLength(1);
  });

  it('the first "@sentinel" on the page is a link to the glossary entry', () => {
    render(<Replay run={RUN} routeId="sample" />);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let first: Node | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node.textContent ?? '').includes('@sentinel')) {
        first = node;
        break;
      }
    }
    expect(first, 'an @sentinel is drawn').not.toBeNull();
    const link = first!.parentElement!.closest('a');
    expect(link, 'the first @sentinel sits in a link').not.toBeNull();
    expect(link).toHaveAttribute('href', SENTINEL_GLOSSARY_HREF);
    expect(link!.textContent).toBe('@sentinel');
    // One such link in the legend: the first occurrence, not every one.
    expect(legend().querySelectorAll(`a[href="${SENTINEL_GLOSSARY_HREF}"]`)).toHaveLength(1);
  });
});

describe('a speaker handle opens its definition', () => {
  it('each drawn prompt has one, named "handle at host, role"', () => {
    render(<Replay run={RUN} routeId="sample" />);
    toEnd();
    const inTranscript = handles().filter((h) => timeline().contains(h));
    const expected = RUN.trace.steps
      .map((step) =>
        step.type === 'principal_instruction'
          ? 'user@console'
          : step.type === 'tool_call' ||
              step.type === 'memory_write' ||
              step.type === 'task_complete'
            ? 'target-agent@sentinel'
            : null,
      )
      .filter(Boolean);
    expect(inTranscript.map((h) => h.getAttribute('data-speaker-handle'))).toEqual(expected);
    for (const handle of inTranscript) {
      const name = handleName(handle.getAttribute('data-speaker-handle')!);
      expect(summaryOf(handle)).toHaveAttribute('aria-label', name);
    }
    expect(summaryOf(inTranscript[1]!)).toHaveAttribute(
      'aria-label',
      'target-agent at sentinel, Agent under test',
    );
    // The detector's prompt on the verdict rail has one too.
    const rail = screen.getByRole('complementary', { name: 'Detector verdict' });
    const detector = handles().filter((h) => rail.contains(h));
    expect(detector.length).toBeGreaterThanOrEqual(1);
    expect(summaryOf(detector[0]!)).toHaveAttribute(
      'aria-label',
      'detector at sentinel, MCProof detector',
    );
  });

  it('is never a button inside a button, and never inside the step control', () => {
    render(<Replay run={RUN} routeId="sample" />);
    toEnd();
    for (const handle of handles()) {
      expect(handle.closest('button')).toBeNull();
      expect(handle.querySelector('button')).toBeNull();
    }
    // The steps are still the list's buttons, all of them and nothing else.
    expect(within(timeline()).getAllByRole('button')).toHaveLength(TOTAL);
  });

  it('opens on a press, shows the role and its sentence, and does not move the playhead', () => {
    render(<Replay run={RUN} routeId="sample" />);
    toEnd();
    const current = () => timeline().querySelector('[aria-current="step"]');
    const before = current();
    const handle = handles().find((h) => timeline().contains(h))!;
    expect(isOpen(handle)).toBe(false);

    fireEvent.click(summaryOf(handle));

    expect(isOpen(handle)).toBe(true);
    const panel = handle.querySelector('[data-speaker-panel]') as HTMLElement;
    expect(panel).toHaveTextContent('Operator. The person giving the agent a normal task.');
    expect(panel.querySelector('.reading')).not.toBeNull();
    expect(current()).toBe(before);
    // Not a live region: opening it announces nothing by itself.
    expect(panel.closest('[aria-live], [role="status"], [role="alert"], [role="log"]')).toBeNull();

    fireEvent.click(summaryOf(handle));
    expect(isOpen(handle)).toBe(false);
  });

  it('only one is open at a time, across the transcript and the verdict rail', () => {
    render(<Replay run={RUN} routeId="sample" />);
    toEnd();
    const [first, second] = handles().filter((h) => timeline().contains(h));
    const rail = screen.getByRole('complementary', { name: 'Detector verdict' });
    const detector = handles().find((h) => rail.contains(h))!;

    fireEvent.click(summaryOf(first!));
    fireEvent.click(summaryOf(second!));
    expect(handles().filter(isOpen)).toEqual([second]);

    fireEvent.click(summaryOf(detector));
    expect(handles().filter(isOpen)).toEqual([detector]);
  });

  it('Escape closes it and puts focus back on the handle', () => {
    render(<Replay run={RUN} routeId="sample" />);
    toEnd();
    const handle = handles().filter((h) => timeline().contains(h))[1]!;
    fireEvent.click(summaryOf(handle));
    const link = handle.querySelector('a')!;
    act(() => link.focus());

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(isOpen(handle)).toBe(false);
    expect(document.activeElement).toBe(summaryOf(handle));
  });

  it('a press outside closes it', () => {
    render(<Replay run={RUN} routeId="sample" />);
    toEnd();
    const handle = handles().find((h) => timeline().contains(h))!;
    fireEvent.click(summaryOf(handle));
    expect(isOpen(handle)).toBe(true);

    fireEvent.click(screen.getByRole('region', { name: 'Step detail' }));

    expect(isOpen(handle)).toBe(false);
  });

  it('a sentinel handle’s definition carries the link to the glossary; the operator’s does not', () => {
    render(<Replay run={RUN} routeId="sample" />);
    toEnd();
    const [operator, agent] = handles().filter((h) => timeline().contains(h));
    fireEvent.click(summaryOf(agent!));
    expect(agent!.querySelector(`a[href="${SENTINEL_GLOSSARY_HREF}"]`)).not.toBeNull();
    fireEvent.click(summaryOf(operator!));
    expect(operator!.querySelector('a')).toBeNull();
  });

  it('a handle in the transcript is not a tab stop of its own, so the list keeps one stop a step', () => {
    render(<Replay run={RUN} routeId="sample" />);
    toEnd();
    for (const handle of handles().filter((h) => timeline().contains(h))) {
      expect(summaryOf(handle).tabIndex).toBe(-1);
    }
  });

  it('the arrow keys move between a step and its handle', () => {
    render(<Replay run={RUN} routeId="sample" />);
    toEnd();
    const handle = handles().find((h) => timeline().contains(h))!;
    const row = handle.closest('li')!.querySelector('button')!;
    act(() => row.focus());
    fireEvent.keyDown(row, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(summaryOf(handle));
    fireEvent.keyDown(summaryOf(handle), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(row);
  });
});

describe('every handle a replay draws has an entry in the roles lookup', () => {
  const runs: [string, RunResult][] = [
    ...CategorySchema.options.map((c): [string, RunResult] => [`sample ${c}`, sampleRun(c)]),
    ['a live run, compromised', liveRun('claude-code', true)],
    ['a live run, clean', liveRun('unknown-client', false)],
  ];

  it.each(runs)('%s', (_name, run) => {
    render(<Replay run={run} routeId="x" />);
    const scrub = screen.getAllByRole('slider', { name: 'Scrub to step' })[0]!;
    fireEvent.change(scrub, { target: { value: String(run.trace.steps.length - 1) } });

    const drawn = handles().map((h) => h.getAttribute('data-speaker-handle')!);
    expect(drawn.length).toBeGreaterThan(1);
    const known = new Set(Object.values(ROLES));
    for (const handle of drawn) {
      expect(known.has(roleForHandle(handle)), handle).toBe(true);
      // None of them is a tool or server handle: a replay draws none today.
      expect(roleForHandle(handle), handle).not.toBe(ROLES.tool);
    }
    // And every handle the page prints, in a prompt or in the legend, is one
    // of those: nothing is drawn that the lookup was not asked about.
    const printed = [
      ...document.querySelectorAll('[data-printed-handle], [data-legend-handle]'),
    ].map((el) => el.textContent ?? '');
    expect(printed.length).toBeGreaterThan(drawn.length);
    for (const handle of printed) expect(drawn, handle).toContain(handle);
  });
});
