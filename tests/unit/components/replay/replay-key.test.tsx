import { render, screen, within } from '@testing-library/react';
import { HeroReplay } from '@/components/home/HeroReplay';
import { Replay } from '@/components/replay';
import {
  HERO_KEY_ID,
  REPLAY_KEY_ID,
  ReplayKey,
  heroKeyEntries,
  transcriptKeyEntries,
} from '@/components/replay/ReplayKey';
import { getDataSource } from '@/data/source';
import { stepColorToken } from '@/lib/hud/trace-view';
import type { RunResult } from '@/contract';

/**
 * THE COLOUR KEY OF A REPLAY (UI audit 2026-10-12, batch D; WCAG 1.4.1, 1.3.1).
 *
 * The replay transcript draws its prompts in one colour, its step text in
 * another and the compromise step in red with a diamond; the hero replay on
 * Home draws one dot per step, coloured by the kind of step. Neither said what
 * the colours mean. Each now has a key: visible text, one entry per colour or
 * mark, tied to the thing it explains with `aria-describedby`.
 *
 * The key is static text. It is never a live region: the replay has one (the
 * step detail), and a second would talk over it.
 */

async function sampleRun(): Promise<RunResult> {
  const run = await getDataSource().getRun('sample');
  if (!run) throw new Error('sample run missing');
  return run;
}

const LIVE =
  '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"], output';

describe('ReplayKey', () => {
  it('draws a named list with one entry of visible text per colour or mark', () => {
    const { container } = render(<ReplayKey id="k" entries={transcriptKeyEntries()} />);
    const key = container.querySelector('#k')!;
    expect(key).toHaveAttribute('data-replay-key');
    const entries = [...key.querySelectorAll('[data-replay-key-entry]')];
    expect(entries.map((e) => e.getAttribute('data-replay-key-entry'))).toEqual([
      'prompt',
      'step',
      'breach',
    ]);
    for (const entry of entries) {
      // Words, not a swatch alone; and the swatch is decoration.
      expect(entry.textContent!.trim().length).toBeGreaterThan(3);
      expect(entry.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
    expect(within(key as HTMLElement).getByText('Key')).toBeInTheDocument();
  });

  it('names the compromise step and shows the same diamond the transcript draws on it', () => {
    const { container } = render(<ReplayKey id="k" entries={transcriptKeyEntries()} />);
    const breach = container.querySelector('[data-replay-key-entry="breach"]')!;
    expect(breach).toHaveTextContent(/compromise step/i);
    expect(breach.querySelector('[data-key-mark="breach"] svg')).not.toBeNull();
  });

  it('is static text: no live region, no status role, nothing to focus', () => {
    const { container } = render(<ReplayKey id="k" entries={transcriptKeyEntries()} />);
    expect(container.querySelector(LIVE)).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector('a, button, [tabindex]')).toBeNull();
  });

  it('labels every entry in the INSTRUMENT role, at the role size, never smaller', () => {
    const { container } = render(<ReplayKey id="k" entries={transcriptKeyEntries()} />);
    for (const entry of container.querySelectorAll('[data-replay-key-entry]')) {
      expect(entry.className.split(/\s+/)).toContain('instrument');
      expect(entry.className).not.toMatch(/text-\[\d+px\]/);
    }
  });
});

describe('the replay transcript and its key', () => {
  it('the step timeline points at a key that is in the document', async () => {
    const run = await sampleRun();
    render(<Replay run={run} routeId="sample" />);
    const timeline = screen.getByRole('list', { name: /step timeline/i });
    expect(timeline).toHaveAttribute('aria-describedby', REPLAY_KEY_ID);
    const key = document.getElementById(REPLAY_KEY_ID)!;
    expect(key).not.toBeNull();
    expect(key).toHaveAttribute('data-replay-key');
    expect(key).toHaveTextContent(/compromise step/i);
    // One key, however many transports the server sends.
    expect(document.querySelectorAll('[data-replay-key]')).toHaveLength(1);
  });

  // It came AFTER the controls and the step detail (batch D). Batch G
  // (2026-10-13, the owner's instruction) moves it directly above the terminal
  // it explains, so this holds the new place and nothing else changed here.
  it('the key comes before the transcript it explains, and so before the controls and the step detail', async () => {
    const run = await sampleRun();
    render(<Replay run={run} routeId="sample" />);
    const key = document.getElementById(REPLAY_KEY_ID)!;
    const timeline = screen.getByRole('list', { name: /step timeline/i });
    const detail = screen.getByRole('region', { name: 'Step detail' });
    const play = screen.getAllByRole('button', { name: 'Play' })[0]!;
    expect(key.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(key.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(key.compareDocumentPosition(play) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the replay still has exactly one live region, and the key is not it', async () => {
    const run = await sampleRun();
    render(<Replay run={run} routeId="sample" />);
    const live = [...document.querySelectorAll(LIVE)];
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveAttribute('aria-label', 'Step detail');
    expect(live[0]!.contains(document.getElementById(REPLAY_KEY_ID))).toBe(false);
  });
});

describe('the hero replay on Home and its key', () => {
  it('the picture points at a key naming each dot colour the trace uses, and the breach', async () => {
    const run = await sampleRun();
    const steps = run.trace.steps;
    const compromiseIndex = steps.findIndex((s) => s.id === run.verdict.stepId) + 1;
    render(
      <HeroReplay
        steps={steps}
        compromiseIndex={compromiseIndex}
        offendingTool="read_file"
        category={run.category}
      />,
    );
    const picture = screen.getByRole('img', { name: /sample replay/i });
    expect(picture).toHaveAttribute('aria-describedby', HERO_KEY_ID);
    const key = document.getElementById(HERO_KEY_ID)!;
    expect(key).toHaveAttribute('data-replay-key');
    // The key is outside the picture: a picture's insides are not read.
    expect(picture.contains(key)).toBe(false);
    expect(key.querySelector('[data-replay-key-entry="breach"]')).toHaveTextContent(/breach/i);
    expect(key.querySelector(LIVE)).toBeNull();
  });

  it('lists only the colours this trace draws, one entry per colour', async () => {
    const run = await sampleRun();
    const entries = heroKeyEntries(run.trace.steps);
    const colours = new Set(run.trace.steps.map((s) => stepColorToken(s.type)));
    // One entry per dot colour in use, and the breach reticle.
    expect(entries.filter((e) => e.id !== 'breach')).toHaveLength(colours.size);
    expect(entries.at(-1)!.id).toBe('breach');
    expect(new Set(entries.map((e) => e.label)).size).toBe(entries.length);
  });

  it('a trace that reads and writes memory gets the memory entry as well', () => {
    const entries = heroKeyEntries([
      { type: 'principal_instruction' },
      { type: 'memory_read' },
      { type: 'memory_write' },
      { type: 'task_complete' },
    ]);
    expect(entries.map((e) => e.id)).toEqual(['principal', 'memory', 'complete', 'breach']);
  });
});
