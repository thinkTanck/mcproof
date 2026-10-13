import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { ConnectCta, CONNECT_CTA_HREF, CONNECT_CTA_LABEL } from '@/components/hud';

/**
 * "CONNECT YOUR AGENT" IS ONE OUTLINED BUTTON (UI audit 2026-10-12, batch B).
 *
 * One component draws it, and every page that offers it uses that component:
 * the same words, the same place to go, an outline with no fill and no glow.
 *
 * The computed colours (a border at least 3:1, a label at least 4.5:1, a
 * transparent background) are measured in a browser, on each page, in
 * tests/e2e/buttons-targets-nav-skip.spec.ts.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.tsx$/.test(entry.name) ? [rel] : [];
  });
}

describe('ConnectCta', () => {
  it('is a link named by its words alone, to Connect', () => {
    render(<ConnectCta />);
    const link = screen.getByRole('link', { name: 'Connect your agent' });
    expect(link).toHaveAttribute('href', '/connect');
    expect(CONNECT_CTA_HREF).toBe('/connect');
    expect(CONNECT_CTA_LABEL).toBe('Connect your agent');
    expect(link).toHaveAttribute('data-cta', 'connect-agent');
    // The arrow is drawn and not read.
    const arrow = link.querySelector('[aria-hidden="true"]');
    expect(arrow?.textContent).toBe('→');
  });

  it('is outlined: a border, no fill, no glow, a full target', () => {
    render(<ConnectCta />);
    const classes = screen.getByRole('link').className.split(/\s+/);
    expect(classes).toContain('border');
    expect(classes).toContain('border-nominal');
    expect(classes).toContain('bg-transparent');
    expect(classes).toContain('text-nominal');
    expect(classes).toContain('target-min');
    // Nothing fills it at rest and nothing glows, at rest or under a pointer.
    expect(classes.filter((c) => /^bg-/.test(c))).toEqual(['bg-transparent']);
    expect(classes.filter((c) => /shadow/.test(c))).toEqual([]);
  });

  it('takes no props, so no page can restyle it', () => {
    expect(ConnectCta.length).toBe(0);
  });

  it('is the only place the words are drawn as a control', () => {
    const offenders = sourceFiles('src')
      .filter((file) => !file.endsWith('components/hud/ConnectCta.tsx'))
      .filter((file) => {
        const source = readFileSync(join(process.cwd(), file), 'utf8');
        // The words inside JSX text, as a link or a button would carry them.
        return />\s*Connect your agent\b/.test(source);
      });
    expect(offenders).toEqual([]);
  });

  it.each([
    // Home draws it through its calls-to-action block (HomeCtas), which the
    // browser-test fixture for the free-runs note draws as well.
    'src/components/home/HomeCtas.tsx',
    'src/app/(hud)/leaderboard/page.tsx',
    'src/app/(hud)/account/page.tsx',
    'src/components/replay/RunDiscarded.tsx',
  ])('%s draws the shared control', (file) => {
    expect(readFileSync(join(process.cwd(), file), 'utf8')).toContain('<ConnectCta />');
  });

  it('Home draws its calls-to-action block, and so the shared control', () => {
    expect(readFileSync(join(process.cwd(), 'src/app/(hud)/page.tsx'), 'utf8')).toContain(
      '<HomeCtas ',
    );
  });
});
