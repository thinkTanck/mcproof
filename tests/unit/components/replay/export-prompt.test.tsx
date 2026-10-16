import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Replay } from '@/components/replay';
import { getDataSource } from '@/data/source';
import type { RunResult } from '@/contract';

/**
 * THE EXPORT PROMPT HAS TWO REAL BUTTONS (owner ruling 2026-10-15 20:26).
 *
 * The verdict terminal ends in a question. It used to be answered with two
 * one-letter links, `[y / n]`, which worked but read as the smallest controls in
 * the app. Now it is "Open fix report" ("Open run result" for a clean run) and
 * "Not now": each at least `--target-min` tall (the `target-min` utility), in
 * the tab order for everyone, touch and desktop. The y and n keys still answer
 * it on a keyboard. "Not now" closes the prompt and opens nothing, and focus
 * lands on the prompt line, so it is not dropped onto the page body.
 */
const ROUTE_ID = 'route-row-7777';

async function sampleRun(): Promise<RunResult> {
  const run = await getDataSource().getRun('sample');
  if (!run) throw new Error('sample run missing');
  return run;
}

function cleanOf(run: RunResult): RunResult {
  return {
    ...run,
    verdict: {
      runId: run.verdict.runId,
      compromised: false,
      score: 0.03,
      severity: 'None',
      category: run.verdict.category,
      rationale: 'The agent did not act on the injected instruction.',
    },
  };
}

const verdictPanel = () => screen.getByRole('complementary', { name: /detector verdict/i });

describe('the export prompt: two real buttons', () => {
  it('offers "Open fix report" (to this run’s report) and "Not now" on a compromise', async () => {
    render(<Replay run={await sampleRun()} routeId={ROUTE_ID} />);
    const panel = verdictPanel();
    const open = within(panel).getByRole('link', { name: 'Open fix report' });
    expect(open).toHaveAttribute('href', `/findings/${ROUTE_ID}`);
    expect(within(panel).getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    // The one-letter answers are gone as controls.
    expect(within(panel).queryByRole('link', { name: /export fix report/i })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /decline export/i })).toBeNull();
  });

  it('reads "Open run result" for a clean run, never "fix report"', async () => {
    render(<Replay run={cleanOf(await sampleRun())} routeId={ROUTE_ID} />);
    const panel = verdictPanel();
    expect(within(panel).getByRole('link', { name: 'Open run result' })).toHaveAttribute(
      'href',
      `/findings/${ROUTE_ID}`,
    );
    expect(within(panel).queryByRole('link', { name: /fix report/i })).toBeNull();
  });

  it('gives both a pointer target of at least --target-min (the target-min utility)', async () => {
    render(<Replay run={await sampleRun()} routeId={ROUTE_ID} />);
    const panel = verdictPanel();
    for (const el of [
      within(panel).getByRole('link', { name: 'Open fix report' }),
      within(panel).getByRole('button', { name: 'Not now' }),
    ]) {
      expect(el.className.split(/\s+/)).toContain('target-min');
      // The global focus ring is the only ring: no component draws its own.
      expect(el.className).not.toMatch(/(^|\s)(focus:outline-none|focus-visible:outline|ring-)/);
    }
  });

  it('puts both in the tab order, Open first', async () => {
    const user = userEvent.setup();
    render(<Replay run={await sampleRun()} routeId={ROUTE_ID} />);
    const panel = verdictPanel();
    const open = within(panel).getByRole('link', { name: 'Open fix report' });
    const notNow = within(panel).getByRole('button', { name: 'Not now' });
    expect(open).not.toHaveAttribute('tabindex', '-1');
    expect(notNow).not.toHaveAttribute('tabindex', '-1');
    open.focus();
    await user.tab();
    expect(notNow).toHaveFocus();
  });

  it('"Not now" closes the prompt, opens nothing, and moves focus to the prompt line', async () => {
    const user = userEvent.setup();
    const clicks: string[] = [];
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a');
      if (a) {
        clicks.push(a.getAttribute('href') ?? '');
        e.preventDefault();
      }
    };
    document.addEventListener('click', onClick);
    try {
      render(<Replay run={await sampleRun()} routeId={ROUTE_ID} />);
      const panel = verdictPanel();
      await user.click(within(panel).getByRole('button', { name: 'Not now' }));
      expect(clicks).toEqual([]);
      expect(within(panel).queryByRole('link', { name: 'Open fix report' })).toBeNull();
      expect(within(panel).queryByRole('button', { name: 'Not now' })).toBeNull();
      expect(within(panel).getByText(/^>\s*ok$/)).toBeInTheDocument();
      const line = within(panel).getByTestId('export-prompt');
      expect(line).toHaveFocus();
    } finally {
      document.removeEventListener('click', onClick);
    }
  });

  it('still answers to the y and n keys', async () => {
    const user = userEvent.setup();
    const clicks: string[] = [];
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a');
      if (a) {
        clicks.push(a.getAttribute('href') ?? '');
        e.preventDefault();
      }
    };
    document.addEventListener('click', onClick);
    try {
      const { unmount } = render(<Replay run={await sampleRun()} routeId={ROUTE_ID} />);
      await user.keyboard('y');
      expect(clicks).toEqual([`/findings/${ROUTE_ID}`]);
      unmount();

      render(<Replay run={await sampleRun()} routeId={ROUTE_ID} />);
      await user.keyboard('n');
      const panel = verdictPanel();
      expect(within(panel).getByText(/^>\s*ok$/)).toBeInTheDocument();
      expect(within(panel).queryByRole('button', { name: 'Not now' })).toBeNull();
      expect(clicks).toEqual([`/findings/${ROUTE_ID}`]);
    } finally {
      document.removeEventListener('click', onClick);
    }
  });
});
