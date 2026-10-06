import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * The ordinary step nodes were 10px dots, small enough that the sweep passing
 * over them barely registered. They are 13px now, with a wider glow. The breach
 * reticle stays 18px: it is the one loud thing in the hero, and it must stay the
 * largest node on the rail.
 */
describe('HeroReplay · node sizes', () => {
  it('draws every ordinary node at 13px, inside a holder of the same size', async () => {
    const { container } = await renderHero();
    const sweeps = [...container.querySelectorAll<HTMLElement>('.hero-sweep')];

    for (const sweep of sweeps) {
      const holder = sweep.parentElement!;
      const node = holder.lastElementChild!;
      expect(holder).toHaveClass('h-[13px]', 'w-[13px]');
      expect(node).toHaveClass('h-[13px]', 'w-[13px]');
      expect(holder.className).not.toMatch(/\b[hw]-2\.5\b/);
      expect(node.className).not.toMatch(/\b[hw]-2\.5\b/);
    }
  });

  it('widens the sweep glow so it reads around the larger node', async () => {
    const { container } = await renderHero();

    for (const sweep of container.querySelectorAll<HTMLElement>('.hero-sweep')) {
      expect(sweep).toHaveClass('inset-[-8px]');
    }
  });

  it('keeps the breach reticle the largest node on the rail', async () => {
    const { container } = await renderHero();
    const marker = container.querySelector('[data-testid="hero-breach-marker"]')!;

    expect(marker).toHaveClass('h-[18px]', 'w-[18px]');
    expect(marker.querySelector('svg')).toHaveAttribute('width', '18');
  });
});

/**
 * THE SWEEP IS A PULSE THAT TRAVELS, NOT A SLOW ROLL CALL.
 *
 * Each node used to light 0.42s after the one above it on a 4.6s loop: about
 * three seconds to crawl down eight nodes, each fading long before the next lit.
 * It read as nodes blinking in turn, and mostly as nothing. The stagger is 0.15s
 * and the loop 3.2s now: the light crosses the rail in about a second as one
 * moving pulse with a short tail, then the rail rests for about as long again.
 */
describe('HeroReplay · sweep timing', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  it('staggers each node 0.15s after the one above it', async () => {
    const { container } = await renderHero();
    const rows = [...container.querySelectorAll<HTMLElement>('[data-testid="hero-step"]')];

    const delays = rows.map(
      (row) => row.querySelector<HTMLElement>('.hero-sweep')?.style.animationDelay,
    );
    rows.forEach((row, i) => {
      // The breach row has no sweep, but it still takes its turn in the count.
      if (row.dataset.breach === 'true') expect(delays[i]).toBeUndefined();
      else expect(delays[i]).toBe(`${(i * 0.15).toFixed(2)}s`);
    });
    // Top to bottom in about a second.
    expect((rows.length - 1) * 0.15).toBeLessThan(1.2);
  });

  it('repeats every 3.2 seconds, with the emphasized easing', () => {
    const rule = /\.hero-sweep\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule).toMatch(/animation:\s*hero-sweep 3\.2s var\(--ease-emphasized\) infinite/);
    expect(rule).not.toMatch(/4\.6s/);
  });

  it('lights each node briefly, so the light reads as one pulse with a short tail', () => {
    const frames = /@keyframes hero-sweep\s*\{([\s\S]*?\})\s*\}/.exec(css)?.[1] ?? '';
    // The last stop at which the glow is still fading out: by then it is dark.
    const stops = [...frames.matchAll(/(\d+)%\s*\{[^}]*opacity:\s*([\d.]+)/g)].map((m) => ({
      at: Number(m[1]),
      opacity: Number(m[2]),
    }));
    const peak = stops.find((s) => s.opacity > 0)!;
    const dark = stops.filter((s) => s.at > peak.at && s.opacity === 0)[0]!;

    // Lit for under a fifth of the loop: about half a second of 3.2.
    expect(peak.at).toBeLessThanOrEqual(8);
    expect(dark.at).toBeLessThanOrEqual(18);
    // Still paint only.
    const properties = [...new Set([...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]))].sort();
    expect(properties).toEqual(['opacity', 'transform']);
  });
});
