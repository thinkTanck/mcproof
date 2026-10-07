import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE HEADER'S HEIGHT IS ONE NUMBER, WRITTEN ONCE (sweep 2026-10-07, X1).
 *
 * The header is sticky, so a control that keyboard focus scrolls to the top edge
 * lands behind it. The fix is `scroll-padding-top` on the document: the browser
 * then stops a focused control below the header. That only stays true while the
 * padding and the header agree on how tall the header is, so the height is a
 * custom property and everything that depends on it reads the property.
 *
 * jsdom computes no layout and loads no stylesheet, so this reads the SOURCE.
 * What the rule does in a browser is measured in
 * tests/e2e/focus-clears-header.spec.ts.
 */
const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const css = read('src/app/globals.css');

describe('--header-h', () => {
  it('is declared once, as 72px', () => {
    const declarations = css.match(/--header-h:\s*[^;]+;/g) ?? [];

    expect(declarations).toEqual(['--header-h: 72px;']);
  });

  it('sets the scroll padding of the document, with a small gap', () => {
    const rule = /html\s*\{[^}]*scroll-padding-top:\s*([^;]+);/.exec(css)?.[1];

    expect(rule).toBeDefined();
    expect(rule).toMatch(/^calc\(var\(--header-h\) \+ \d+px\)$/);
  });

  it('is what the header itself is sized by', () => {
    const header = /<header className="([^"]+)"/.exec(
      read('src/components/shell/StatusBar.tsx'),
    )?.[1];

    expect(header).toBeDefined();
    expect(header).toMatch(/\bh-\(--header-h\)/);
    expect(header).not.toMatch(/h-\[72px\]/);
  });

  it.each([
    'src/components/shell/StatusBar.tsx',
    'src/components/shell/AppShell.tsx',
    'src/components/shell/CommandDeck.tsx',
    'src/components/shell/MobileDrawer.tsx',
    'src/components/replay/Replay.tsx',
    'src/components/connect/LiveRunConsole.tsx',
  ])('%s holds no second copy of the header height in a class', (file) => {
    // Class names only: prose in comments may still say "the 72px header".
    const classes = [...read(file).matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
      .map((m) => m[1] ?? m[2] ?? '')
      .join(' ')
      // The icon rail is 72px WIDE. That is its own measurement, which happens to
      // equal the header's height; it does not follow the header.
      .replace(/\S*\bw-\[72px\]/g, '');

    expect(classes).not.toMatch(/72px/);
    // The run bar is pinned 8px under the header: that used to be a bare 80px.
    expect(classes).not.toMatch(/top-\[80px\]/);
  });
});
