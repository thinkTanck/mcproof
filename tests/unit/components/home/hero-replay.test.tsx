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
      // Compared as a number: the DOM hands "0.00s" back as "0s".
      else expect(parseFloat(delays[i]!)).toBeCloseTo(i * 0.15, 5);
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
    // Every stop with its opacity, in order. One block can name several stops
    // ("0%, 40%, 100%"), and blocks are not written in time order.
    const stops = [...frames.matchAll(/((?:\d+%\s*,?\s*)+)\{[^}]*opacity:\s*([\d.]+)/g)]
      .flatMap((m) =>
        [...m[1]!.matchAll(/(\d+)%/g)].map((stop) => ({
          at: Number(stop[1]),
          opacity: Number(m[2]),
        })),
      )
      .sort((a, b) => a.at - b.at);
    const peak = stops.find((s) => s.opacity > 0)!;
    const dark = stops.find((s) => s.at > peak.at && s.opacity === 0)!;

    // Lit for under a fifth of the loop: about half a second of 3.2.
    expect(peak.at).toBeLessThanOrEqual(8);
    expect(dark.at).toBeLessThanOrEqual(18);
    // Still paint only.
    const properties = [...new Set([...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]))].sort();
    expect(properties).toEqual(['opacity', 'transform']);
  });
});

/**
 * THE FRAME ACCENT: one dim cyan light that goes round the box's border, once
 * every 14.4 seconds. It is the cue that the box is a readout and not a picture.
 *
 * It is deliberately small. The breach marker is the one loud thing in this box
 * and has to stay that: the accent is a single pixel thick, a sliver of the
 * border and not an outline of it, in the nominal cyan mixed down, with no glow.
 * It is decoration, so it is hidden from assistive technology and takes no
 * clicks, and it is absolutely positioned so it cannot change the box's size.
 */
describe('HeroReplay · the frame accent', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const rule = (re: RegExp) => re.exec(css)?.[1] ?? '';

  it('renders exactly one accent, inside the box, hidden from assistive technology', async () => {
    const { container } = await renderHero();
    const box = screen.getByRole('img', { name: /sample replay/i });
    const accents = container.querySelectorAll('[data-testid="hero-frame-accent"]');

    expect(accents).toHaveLength(1);
    expect(box).toContainElement(accents[0] as HTMLElement);
    expect(accents[0]).toHaveAttribute('aria-hidden', 'true');
    expect(accents[0]).toHaveClass('hero-frame-accent');
    expect(accents[0]).toHaveTextContent('');
    // One moving light inside it, and nothing else.
    expect(accents[0]!.children).toHaveLength(1);
    expect(accents[0]!.firstElementChild).toHaveClass('hero-frame-accent-light');
  });

  it('does not change the labels or the breach it frames', async () => {
    const { container } = await renderHero();

    expect(container).toHaveTextContent(/sample replay/i);
    expect(container).toHaveTextContent(/recorded/i);
    const breach = container.querySelector('[data-testid="hero-step"][data-breach="true"]')!;
    expect(breach).toHaveTextContent('s6');
    expect(container.querySelectorAll('[data-testid="hero-breach-marker"]')).toHaveLength(1);
  });

  it('is laid over the box without taking part in its layout', () => {
    const accent = rule(/\.hero-frame-accent\s*\{([^}]*)\}/);

    expect(accent).toMatch(/position:\s*absolute/);
    expect(accent).toMatch(/inset:\s*0/);
    expect(accent).toMatch(/pointer-events:\s*none/);
    expect(accent).toMatch(/border-radius:\s*inherit/);
  });

  it('shows only a one-pixel ring of itself: the border, not the box', () => {
    const accent = rule(/\.hero-frame-accent\s*\{([^}]*)\}/);

    expect(accent).toMatch(/padding:\s*1px/);
    expect(accent).toMatch(/mask-composite:\s*exclude/);
    expect(accent).toMatch(/overflow:\s*hidden/);
  });

  it('is one sliver of light in the nominal cyan, mixed down, with no glow', () => {
    const light = rule(/\.hero-frame-accent-light\s*\{([^}]*)\}/);

    expect(light).toMatch(/conic-gradient/);
    const share = Number(/var\(--status-nominal\)\s+(\d+)%/.exec(light)?.[1]);
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThanOrEqual(70);
    // Transparent for most of the turn: a sliver, never a full outline.
    const dark = Number(/transparent\s+0deg\s+(\d+)deg/.exec(light)?.[1]);
    expect(dark).toBeGreaterThanOrEqual(300);
    expect(light).not.toMatch(/box-shadow|drop-shadow|filter/);
    expect(light).not.toMatch(/breach|caution|red-|amber-/);
  });

  it('goes round once every 14.4 seconds at a constant rate, moving by transform only', () => {
    const light = rule(/\.hero-frame-accent-light\s*\{([^}]*)\}/);
    const frames = rule(/@keyframes hero-frame-lap\s*\{([\s\S]*?\})\s*\}/);

    expect(light).toMatch(
      /animation:\s*hero-frame-lap calc\(var\(--motion-sweep\) \* 12\) linear infinite/,
    );
    expect(frames).not.toBe('');
    const properties = [...new Set([...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]))];
    expect(properties).toEqual(['transform']);
    expect(frames).toMatch(/rotate\(360deg\)/);
  });

  it('is not drawn at all under prefers-reduced-motion', () => {
    const reduce =
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/.exec(
        css.slice(0, css.indexOf('@utility measure')),
      )?.[1] ?? '';

    expect(reduce).toMatch(/\.hero-frame-accent\s*\{[^}]*display:\s*none/);
    expect(reduce).toMatch(/\.hero-frame-accent-light[^{]*\{[^}]*animation:\s*none/);
  });
});

/**
 * THE GLOW RESTS DARK.
 *
 * The sweep's glow is only meant to be seen while it is passing. It had no
 * resting opacity, so wherever the animation was not running it sat fully lit:
 * on every node still waiting out its stagger delay after the page loads, and on
 * every node, permanently, under `prefers-reduced-motion`. Nobody saw that while
 * the glow named a colour that did not exist; once it had a real colour (#183)
 * the resting trace was a column of lit halos.
 */
describe('HeroReplay · the sweep glow at rest', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  it('is dark unless the animation is lighting it', () => {
    const rule = /\.hero-sweep\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule).toMatch(/\bopacity:\s*0\b/);
  });

  it('starts dark and ends dark in the animation too, so the loop joins cleanly', () => {
    const frames = /@keyframes hero-sweep\s*\{([\s\S]*?\})\s*\}/.exec(css)?.[1] ?? '';
    const ends = /0%,[\s\S]*?100%\s*\{([^}]*)\}/.exec(frames)?.[1] ?? '';

    expect(ends).toMatch(/opacity:\s*0\b/);
  });
});
