import { render, screen } from '@testing-library/react';
import { HeroReplay } from '@/components/home/HeroReplay';
import { getDataSource } from '@/data/source';
import { offendingStepLabel } from '@/lib/hud/trace-view';
import type { RunResult } from '@/contract';

/**
 * The hero micro-replay: a compact animated replay of the FEATURED sample trace
 * (ASI02), with the breach indicator lighting at the offending read_file step.
 * It is bound to the real sample RunResult, never a literal, exactly like the
 * SampleTrailer it shares a trace with.
 */
async function sampleRun(): Promise<RunResult> {
  const run = await getDataSource().getRun('sample');
  if (!run) throw new Error('sample run missing');
  return run;
}

function compromise(run: RunResult): { index: number; tool: string } {
  const steps = run.trace.steps;
  const index = steps.findIndex((s) => s.id === run.verdict.stepId) + 1;
  return { index, tool: offendingStepLabel(steps[index - 1]!) };
}

describe('HeroReplay', () => {
  it('exposes an accessible micro-replay named for the featured category', async () => {
    const run = await sampleRun();
    const { index, tool } = compromise(run);
    render(
      <HeroReplay
        steps={run.trace.steps}
        compromiseIndex={index}
        offendingTool={tool}
        category={run.category}
      />,
    );
    expect(screen.getByRole('img', { name: /ASI02 sample replay/i })).toBeInTheDocument();
  });

  it('draws one node per real step (bound to the trace, never a literal)', async () => {
    const run = await sampleRun();
    const { index, tool } = compromise(run);
    const { container } = render(
      <HeroReplay
        steps={run.trace.steps}
        compromiseIndex={index}
        offendingTool={tool}
        category={run.category}
      />,
    );
    expect(container.querySelectorAll('[data-testid="hero-step"]')).toHaveLength(
      run.trace.steps.length,
    );
  });

  it('lights exactly the offending step as the breach, at verdict.stepId', async () => {
    const run = await sampleRun();
    const { index, tool } = compromise(run);
    const { container } = render(
      <HeroReplay
        steps={run.trace.steps}
        compromiseIndex={index}
        offendingTool={tool}
        category={run.category}
      />,
    );
    const nodes = Array.from(container.querySelectorAll('[data-testid="hero-step"]'));
    const breached = nodes.filter((n) => n.getAttribute('data-breach') === 'true');
    expect(breached).toHaveLength(1);
    // It is the compromise step (1-based index), and it names the offending tool.
    expect(nodes.indexOf(breached[0]!)).toBe(index - 1);
    expect(breached[0]!.textContent ?? '').toMatch(new RegExp(tool, 'i'));
  });

  it('labels the replay as a recorded sample, never asserting a live run', async () => {
    const run = await sampleRun();
    const { index, tool } = compromise(run);
    render(
      <HeroReplay
        steps={run.trace.steps}
        compromiseIndex={index}
        offendingTool={tool}
        category={run.category}
      />,
    );
    // A green "LIVE" indicator on a constructed sample fixture overclaims: this is
    // recorded, not a live run. The label must say so, and must not read "live".
    expect(screen.queryByText(/\blive\b/i)).not.toBeInTheDocument();
    expect(screen.getByText(/sample replay/i)).toBeInTheDocument();
    expect(screen.getByText(/^recorded$/i)).toBeInTheDocument();
  });

  it('gives the breach step a distinct graphic marker, not just a red word', async () => {
    const run = await sampleRun();
    const { index, tool } = compromise(run);
    const { container } = render(
      <HeroReplay
        steps={run.trace.steps}
        compromiseIndex={index}
        offendingTool={tool}
        category={run.category}
      />,
    );
    // The compromise is the focal point of the hero, so the breach step carries a
    // graphic marker of its own that the other steps do not.
    const markers = container.querySelectorAll('[data-testid="hero-breach-marker"]');
    expect(markers).toHaveLength(1);
  });
});

async function renderHero() {
  const run = await sampleRun();
  const { index, tool } = compromise(run);
  return render(
    <HeroReplay
      steps={run.trace.steps}
      compromiseIndex={index}
      offendingTool={tool}
      category={run.category}
    />,
  );
}

/**
 * The travelling sweep: a soft glow behind each ordinary step, lit in turn. Its
 * colour has to be a token that exists. It named `--cyan-400`, which the ramp
 * does not have, so the glow was an invalid declaration and painted nothing.
 */
describe('HeroReplay · the sweep glow', () => {
  it('is coloured from the core cyan, a token the ramp really has', async () => {
    const { container } = await renderHero();
    const sweeps = [...container.querySelectorAll<HTMLElement>('.hero-sweep')];

    expect(sweeps.length).toBeGreaterThan(0);
    for (const sweep of sweeps) {
      const background = sweep.getAttribute('style') ?? '';
      expect(background).toContain('var(--cyan-300)');
      expect(background).not.toContain('cyan-400');
    }
  });

  it('sits behind every step except the breach, which has its own marker', async () => {
    const { container } = await renderHero();
    const rows = [...container.querySelectorAll<HTMLElement>('[data-testid="hero-step"]')];
    const breach = rows.filter((row) => row.dataset.breach === 'true');

    expect(breach).toHaveLength(1);
    expect(breach[0]!.querySelector('.hero-sweep')).toBeNull();
    expect(container.querySelectorAll('.hero-sweep')).toHaveLength(rows.length - 1);
  });
});
