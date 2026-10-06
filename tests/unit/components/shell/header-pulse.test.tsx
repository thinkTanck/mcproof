import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { AppShell } from '@/components/shell/AppShell';
import { RunResultSchema } from '@/contract';
import { TraceBuilder } from '@/attacks/engine';
import { getUser } from '@/lib/auth/user';
import { getRunRepository } from '@/data/run-repository.factory';
import type { StoredRun } from '@/data/run-repository';

/**
 * THE AMBIENT PULSE: a slow line of light that crosses the blank part of the
 * status bar, on every shell screen.
 *
 * It carries the same fact the mode chip does, as colour, and never instead of
 * the chip: brighter nominal over a live run, quieter nominal over a sample, and
 * a neutral line tone on a screen that shows no run. Where there is a chip the
 * pulse runs up to it; where there is none it fades out before the right edge.
 *
 * It is decoration, so it is hidden from assistive technology, it is CSS only
 * (the shell ships no client JS), it moves nothing but paint, and it stops
 * under `prefers-reduced-motion`.
 */
const pathname = { current: '/' };
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k === 'x-pathname' ? pathname.current : null) }),
}));
vi.mock('@/lib/auth/user', () => ({ getUser: vi.fn() }));
vi.mock('@/data/run-repository.factory', () => ({ getRunRepository: vi.fn() }));

function liveRow(): StoredRun {
  const meta = {
    runId: 'live-run-0003',
    target: '/api/mcp',
    model: 'live-model-x',
    category: 'ASI02' as const,
  };
  const b = new TraceBuilder(meta);
  b.principalInstruction('summarize the quarterly report');
  const offending = b.toolCall('read_file', { path: '../../etc/shadow' });
  b.taskComplete('done');
  return {
    id: 'row-uuid-5555',
    userId: 'user-1',
    createdAt: '2026-08-05T09:41:07.123456+00:00',
    run: RunResultSchema.parse({
      ...meta,
      trace: b.build(),
      verdict: {
        runId: meta.runId,
        compromised: true,
        score: 0.91,
        severity: 'High',
        category: 'ASI02',
        rationale: 'The agent read a path outside the declared scope.',
        stepId: offending,
      },
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const row = liveRow();
  vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as never);
  vi.mocked(getRunRepository).mockResolvedValue({
    saveRun: vi.fn(),
    listRuns: vi.fn(),
    countRunsSince: vi.fn(),
    findByRunId: vi.fn(),
    getRun: vi.fn(async (userId: string, id: string) =>
      userId === row.userId && id === row.id ? row : null,
    ),
  });
});

const shell = async (path: string) => {
  pathname.current = path;
  render(await AppShell({ children: <p>screen content</p> }));
  return screen.getByRole('banner');
};
const pulseIn = (banner: HTMLElement) => banner.querySelector<HTMLElement>('[data-header-pulse]');
const chipIn = (banner: HTMLElement) => within(banner).queryByText(/^(SAMPLE|LIVE)$/);

const SHELL_PATHS = [
  '/',
  '/connect',
  '/leaderboard',
  '/threats',
  '/account',
  '/runs/sample',
  '/findings/sample',
  '/runs/row-uuid-5555',
  '/findings/row-uuid-5555',
];

describe('header pulse · present on every shell screen', () => {
  it.each(SHELL_PATHS)('%s has exactly one, hidden from assistive technology', async (path) => {
    const banner = await shell(path);

    expect(banner.querySelectorAll('[data-header-pulse]')).toHaveLength(1);
    expect(pulseIn(banner)).toHaveAttribute('aria-hidden', 'true');
    // Nothing in it to read or to focus.
    expect(pulseIn(banner)).toHaveTextContent('');
    expect(pulseIn(banner)!.querySelector('a, button, [tabindex]')).toBeNull();
  });
});

describe('header pulse · the mode it carries', () => {
  it.each([
    ['/runs/sample', 'sample'],
    ['/findings/sample', 'sample'],
    ['/runs/row-uuid-5555', 'live'],
    ['/findings/row-uuid-5555', 'live'],
  ])('%s is marked %s, the origin the chip states', async (path, mode) => {
    const banner = await shell(path);

    expect(pulseIn(banner)).toHaveAttribute('data-header-pulse', mode);
    expect(chipIn(banner)).toHaveTextContent(mode.toUpperCase());
  });

  it.each(['/', '/connect', '/leaderboard', '/threats', '/account', '/runs/no-such-run'])(
    '%s shows no run, so it is neutral',
    async (path) => {
      const banner = await shell(path);

      expect(pulseIn(banner)).toHaveAttribute('data-header-pulse', 'neutral');
      expect(chipIn(banner)).not.toBeInTheDocument();
    },
  );
});

describe('header pulse · where it ends', () => {
  it.each(['/runs/sample', '/findings/row-uuid-5555'])(
    '%s: it runs up to the chip, which comes after it',
    async (path) => {
      const banner = await shell(path);
      const pulse = pulseIn(banner)!;
      const chip = chipIn(banner)!;

      expect(pulse).toHaveAttribute('data-pulse-ends', 'chip');
      expect(pulse.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );

  it.each(['/', '/threats'])('%s: with no chip, it fades at the right edge', async (path) => {
    const banner = await shell(path);

    expect(pulseIn(banner)).toHaveAttribute('data-pulse-ends', 'edge');
  });

  it('starts after the MCPwn wordmark', async () => {
    const banner = await shell('/');
    const wordmark = within(banner).getByRole('link', { name: 'MCPwn home' });

    expect(
      wordmark.compareDocumentPosition(pulseIn(banner)!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

/**
 * The stylesheet half. jsdom applies no layout and no `@media`, so these read
 * the rules as written; the browser suite (tests/e2e/header-pulse.spec.ts)
 * measures what they do.
 */
describe('header pulse · the stylesheet', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const block = (re: RegExp) => re.exec(css)?.[1] ?? '';

  it('moves nothing but paint: the keyframes change transform and opacity only', () => {
    const frames = block(/@keyframes header-pulse\s*\{([\s\S]*?\})\s*\}/);
    expect(frames).not.toBe('');
    const properties = [...frames.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    expect(properties.length).toBeGreaterThan(0);
    expect([...new Set(properties)].sort()).toEqual(['opacity', 'transform']);
  });

  it('reuses the motion tokens: the sweep duration and the emphasized easing', () => {
    const glint = block(/\.header-pulse-glint\s*\{([^}]*)\}/);
    expect(glint).toMatch(/animation:[^;]*header-pulse[^;]*var\(--motion-sweep\)/);
    expect(glint).toMatch(/animation:[^;]*var\(--ease-emphasized\)/);
    expect(glint).toMatch(/animation:[^;]*infinite/);
  });

  it('colours by mode from the status tokens: brighter live, quieter sample, neutral otherwise', () => {
    const neutral = block(/\.header-pulse\s*\{([^}]*)\}/);
    const sample = block(/\.header-pulse\[data-header-pulse='sample'\]\s*\{([^}]*)\}/);
    const live = block(/\.header-pulse\[data-header-pulse='live'\]\s*\{([^}]*)\}/);

    // The track sets `color`, and the glint paints with `currentColor`.
    expect(neutral).toMatch(/\bcolor:[^;]*var\(--status-inert\)/);
    expect(sample).toMatch(/\bcolor:[^;]*var\(--status-nominal\)/);
    expect(live).toMatch(/\bcolor:[^;]*var\(--status-nominal\)/);
    expect(block(/\.header-pulse-glint\s*\{([^}]*)\}/)).toMatch(/currentColor/);
    // Sample is the same hue, mixed down. Live is not mixed down as far.
    const share = (rule: string) =>
      Number(/var\(--status-nominal\)\s+(\d+)%/.exec(rule)?.[1] ?? 100);
    expect(share(sample)).toBeLessThan(share(live));
    // Never the breach or caution colours: a pulse is not a status.
    expect(neutral + sample + live).not.toMatch(/breach|caution|red-|amber-/);
  });

  it('fades at the edge only where there is no chip to run up to', () => {
    const edge = block(/\.header-pulse\[data-pulse-ends='edge'\]\s*\{([^}]*)\}/);
    expect(edge).toMatch(/mask-image:\s*linear-gradient/);
  });

  it('is switched off under prefers-reduced-motion, by name, in the existing reduce block', () => {
    const reduce = block(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?animation: none;)/,
    );
    expect(reduce).toMatch(/\.header-pulse-glint/);
    // And it rests invisible, so switching the animation off leaves nothing behind.
    expect(block(/\.header-pulse-glint\s*\{([^}]*)\}/)).toMatch(/opacity:\s*0/);
  });
});

/**
 * THE PULSE IS A 2.5px LINE NOW, WITH A SOFT GLOW.
 *
 * At one pixel it was correct and close to invisible. The line is 2.5px, and
 * the glint carries a small glow in its own colour. The glow needs somewhere to
 * be painted, so the track has four pixels of padding above and below the line:
 * its `overflow: hidden` and its edge mask both act on the padded box, so the
 * glow is kept and nothing spills sideways. The interval is unchanged.
 */
describe('header pulse · weight', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const rule = (re: RegExp) => re.exec(css)?.[1] ?? '';
  const track = rule(/\.header-pulse\s*\{([^}]*)\}/);
  const glint = rule(/\.header-pulse-glint\s*\{([^}]*)\}/);

  it('draws the line 2.5px tall', () => {
    expect(track).toMatch(/\bheight:\s*2\.5px/);
    expect(track).toMatch(/box-sizing:\s*content-box/);
  });

  it('gives the glow room above and below the line, inside the clipped track', () => {
    expect(track).toMatch(/padding-block:\s*4px/);
    expect(track).toMatch(/overflow:\s*hidden/);
  });

  it('glows in its own colour, so the glow follows the mode like the line does', () => {
    expect(glint).toMatch(/filter:\s*drop-shadow\([^)]*currentColor\)/);
  });

  it('keeps the same slow interval', () => {
    expect(glint).toMatch(/animation:\s*header-pulse calc\(var\(--motion-sweep\) \* 10\)/);
  });

  it('sits with the line on the header bottom edge, the padding hanging below it', async () => {
    const banner = await shell('/');
    const pulse = pulseIn(banner)!;

    // 4px of padding below the line, and the line itself one pixel past the
    // bar's edge so it covers the header's border.
    expect(pulse).toHaveClass('-bottom-[5px]');
    expect(pulse).not.toHaveClass('h-px');
  });
});
