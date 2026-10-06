import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render, within } from '@testing-library/react';
import { StatusBar } from '@/components/shell/StatusBar';
import SignIn from '@/app/sign-in/page';
import NotFound from '@/app/not-found';

/**
 * ONE LOGO RING, EVERYWHERE THE LOCKUP APPEARS.
 *
 * The lockup (the ring beside the MCPwn wordmark, linking home) is drawn in
 * three places: the status bar, the sign-in page and the not-found page. Each
 * had its own copy of the ring's SVG. When the status bar's ring was enlarged
 * and given a visible, turning arc, the other two kept what they had: a 24px
 * and a 22px ring with the old thin `6 44` arc, not turning. Three lockups.
 *
 * The ring is one component now, and these hold every lockup to it.
 */
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => (k === 'x-pathname' ? '/ghost/route' : null) }),
}));

const root = process.cwd();
const SRC = join(root, 'src');
const show = (path: string) => relative(root, path).replace(/\\/g, '/');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/** Every file that draws the lockup: it holds the home link the ring sits in. */
const lockupFiles = sourceFiles(SRC).filter((file) =>
  readFileSync(file, 'utf8').includes('aria-label="MCPwn home"'),
);

/** The ring inside a rendered lockup, as the facts that make it look the way it does. */
function ringIn(container: HTMLElement) {
  const link = within(container).getByRole('link', { name: 'MCPwn home' });
  const svg = link.querySelector('svg')!;
  const [track, arc, hub] = [...svg.querySelectorAll('circle')];
  return {
    width: svg.getAttribute('width'),
    height: svg.getAttribute('height'),
    viewBox: svg.getAttribute('viewBox'),
    className: svg.getAttribute('class'),
    hidden: svg.getAttribute('aria-hidden'),
    track: `${track?.getAttribute('stroke')} ${track?.getAttribute('stroke-width')}`,
    arc: {
      stroke: arc?.getAttribute('stroke'),
      width: arc?.getAttribute('stroke-width'),
      cap: arc?.getAttribute('stroke-linecap'),
      dash: arc?.getAttribute('stroke-dasharray'),
      radius: arc?.getAttribute('r'),
    },
    hub: `${hub?.getAttribute('fill')} ${hub?.getAttribute('r')}`,
  };
}

const statusBarRing = () => ringIn(render(<StatusBar pathname="/" />).container);

describe('logo ring · every lockup draws the same ring', () => {
  it('finds the three places the lockup is drawn', () => {
    expect(lockupFiles.map(show).sort()).toEqual([
      'src/app/not-found.tsx',
      'src/app/sign-in/page.tsx',
      'src/components/shell/StatusBar.tsx',
    ]);
  });

  it('sign-in draws the status bar ring: same size, same arc, same turn', async () => {
    const expected = statusBarRing();
    const signIn = ringIn(render(await SignIn({ searchParams: Promise.resolve({}) })).container);

    expect(signIn).toEqual(expected);
  });

  it('not-found draws the status bar ring: same size, same arc, same turn', async () => {
    const expected = statusBarRing();
    const notFound = ringIn(render(await NotFound()).container);

    expect(notFound).toEqual(expected);
  });

  it('the ring they share is the one from #183: 34px, one quarter arc, a 13s turn', () => {
    const ring = statusBarRing();

    expect(ring.width).toBe('34');
    expect(ring.height).toBe('34');
    expect(ring.arc).toEqual({
      stroke: 'var(--status-nominal)',
      width: '2',
      cap: 'round',
      dash: '14 42.55',
      radius: '9',
    });
    expect(ring.className).toContain('animate-[spin_13s_linear_infinite]');
    expect(ring.hidden).toBe('true');
  });
});

describe('logo ring · one definition', () => {
  it.each(lockupFiles.map(show))(
    '%s uses the shared LogoRing and draws no ring of its own',
    (file) => {
      const code = readFileSync(join(root, file), 'utf8');

      expect(code).toMatch(/<LogoRing\b/);
      // No hand-drawn ring left behind: the arc's dash pattern is the tell.
      expect(code).not.toMatch(/strokeDasharray/);
    },
  );

  it('keeps the old thin arc out of the source entirely', () => {
    const stale = sourceFiles(SRC)
      .filter((file) => /strokeDasharray="6 44"/.test(readFileSync(file, 'utf8')))
      .map(show);

    expect(stale).toEqual([]);
  });
});
